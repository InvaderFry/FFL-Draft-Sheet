"""Integration tests for /api/sheet and /health endpoints (U10)."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from app.main import app
from app import cache
from app.data.scraper import ScrapeResult, SourceOutcome


@pytest.fixture(autouse=True)
def clear_cache():
    """Ensure cache is clean before each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def mock_variance_loader(monkeypatch):
    """Keep sheet-generation tests offline by replacing nfl_data_py weekly loading."""
    monkeypatch.setattr("app.main.load_variance", lambda season: {
        "player_cv": {},
        "pos_median_cv": {pos: 0.45 for pos in ["QB", "RB", "WR", "TE", "DST"]},
    })


# ---- health ------------------------------------------------------------------

def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ---- default 12-team request -------------------------------------------------

def _mock_scrape_result():
    """Minimal scrape result with a handful of players per position."""
    positions = ["QB", "RB", "WR", "TE", "DST"]
    result = {}
    for pos in positions:
        rows = []
        for i in range(20):
            if pos == "QB":
                pts = 350.0 - i * 15
            elif pos == "DST":
                pts = 150.0 - i * 5
            else:
                pts = 300.0 - i * 10
            rows.append({
                "source": "FantasyPros",
                "player_name": f"{pos}Player{i}",
                "pos": pos,
                "team": "KC",
                "sleeper_id": f"{pos.lower()}_{i}",
                "espn_id": str(1000 + i),
                "points": pts,
            })
        result[pos] = rows
    return ScrapeResult(result)


def _mock_scrape_result_with_sources(sources):
    result = {pos: [] for pos in ["QB", "RB", "WR", "TE", "DST"]}
    outcomes = []
    for pos in result:
        for source in sources:
            result[pos].append({
                "source": source,
                "player_name": f"{source}{pos}Player",
                "pos": pos,
                "team": "KC",
                "sleeper_id": f"{source.lower()}_{pos.lower()}",
                "espn_id": None,
                "points": 100.0,
            })
            outcomes.append(SourceOutcome(source=source, position=pos, rows=1, reason=None))
    return ScrapeResult(result, outcomes=outcomes)


def _mock_attrition_curves():
    return {pos: [14.0] * 80 for pos in ["QB", "RB", "WR", "TE", "DST", "K"]}


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_default_sheet_returns_200(mock_adp, mock_players, mock_curves, mock_scrape, client):
    mock_scrape.return_value = _mock_scrape_result()
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    payload = {
        "n_teams": 12,
        "fantasy_weeks": 14,
        "QB": 1, "RB": 2, "WR": 3, "TE": 1, "DST": 1, "K": 0,
        "flex_slots": 1,
    }
    resp = client.post("/api/sheet", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "positions" in data
    assert "RB" in data["positions"]
    assert len(data["positions"]["RB"]) > 0
    assert "mean_pts" in data["positions"]["RB"][0]
    assert "baseline" in data["positions"]["RB"][0]
    assert data["metadata"]["data_quality_warnings"] == []


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_inflated_projection_adds_data_quality_warning(mock_adp, mock_players, mock_curves, mock_scrape, client):
    rows = _mock_scrape_result()
    rows["WR"][0]["points"] = 934.8
    mock_scrape.return_value = rows
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    resp = client.post("/api/sheet", json={"n_teams": 12, "QB": 1, "RB": 2, "WR": 3,
                                           "TE": 1, "DST": 1, "K": 0, "flex_slots": 1})

    assert resp.status_code == 200
    warnings = resp.json()["metadata"]["data_quality_warnings"]
    assert warnings == [
        "WR projections appear inflated (top mean_pts=934.8, expected <=400). "
        "Data may be unreliable this early in the season."
    ]


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_all_positions_populated(mock_adp, mock_players, mock_curves, mock_scrape, client):
    mock_scrape.return_value = _mock_scrape_result()
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    resp = client.post("/api/sheet", json={"n_teams": 12, "QB": 1, "RB": 2, "WR": 3,
                                           "TE": 1, "DST": 1, "K": 0, "flex_slots": 1})
    assert resp.status_code == 200
    positions = resp.json()["positions"]
    for pos in ["QB", "RB", "WR", "TE", "DST"]:
        assert pos in positions
        assert len(positions[pos]) > 0


# ---- kicker is accepted but not part of the scored board ---------------------

@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_kicker_starters_accepted_but_no_k_position(mock_adp, mock_players, mock_curves, mock_scrape, client):
    mock_scrape.return_value = _mock_scrape_result()  # QB/RB/WR/TE/DST only
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    # K=1 must validate (forward-compat) but produce no K board.
    resp = client.post("/api/sheet", json={"n_teams": 12, "QB": 1, "RB": 2, "WR": 3,
                                           "TE": 1, "DST": 1, "K": 1, "flex_slots": 1})
    assert resp.status_code == 200
    positions = resp.json()["positions"]
    assert "K" not in positions
    for pos in ["QB", "RB", "WR", "TE", "DST"]:
        assert pos in positions


# ---- validation --------------------------------------------------------------

def test_invalid_team_count_returns_422(client):
    resp = client.post("/api/sheet", json={"n_teams": 5})
    assert resp.status_code == 422


def test_invalid_flex_alloc_returns_422(client):
    resp = client.post("/api/sheet", json={
        "n_teams": 12, "flex_rb": 0.9, "flex_wr": 0.9, "flex_te": 0.1,
        "QB": 1, "RB": 2, "WR": 3, "TE": 1, "DST": 1, "K": 0,
    })
    assert resp.status_code == 422


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_player_map_async")
def test_generation_failure_returns_generic_500_detail(mock_players, mock_scrape, client):
    """Internal exception text (paths, upstream errors) must not reach clients."""
    mock_players.return_value = {}
    mock_scrape.side_effect = RuntimeError("secret /internal/path leaked")
    resp = client.post("/api/sheet", json={"n_teams": 12})
    assert resp.status_code == 500
    assert resp.json()["detail"] == "Sheet generation failed"


# ---- all-sources-down graceful degradation -----------------------------------

@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_all_sources_down_returns_200_with_empty_positions(mock_adp, mock_players, mock_curves, mock_scrape, client):
    # All sources return empty lists
    mock_scrape.return_value = {pos: [] for pos in ["QB", "RB", "WR", "TE", "DST"]}
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    resp = client.post("/api/sheet", json={"n_teams": 12, "QB": 1, "RB": 2, "WR": 3,
                                           "TE": 1, "DST": 1, "K": 0, "flex_slots": 1})
    assert resp.status_code == 200
    meta = resp.json()["metadata"]
    assert meta["sources_used"] == []


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_sheet_metadata_includes_structured_used_source_statuses(mock_adp, mock_players, mock_curves, mock_scrape, client):
    mock_scrape.return_value = _mock_scrape_result_with_sources(["FantasyPros", "ESPN"])
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    resp = client.post("/api/sheet", json={"n_teams": 12, "QB": 1, "RB": 2, "WR": 3,
                                           "TE": 1, "DST": 1, "K": 0, "flex_slots": 1})

    assert resp.status_code == 200
    meta = resp.json()["metadata"]
    assert meta["sources_used"] == ["ESPN", "FantasyPros"]
    statuses = {entry["source"]: entry for entry in meta["source_statuses"]}
    assert statuses["FantasyPros"]["status"] == "used"
    assert statuses["FantasyPros"]["used"] is True
    assert statuses["FantasyPros"]["positions"] == ["DST", "QB", "RB", "TE", "WR"]
    assert statuses["ESPN"]["status"] == "used"


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_sheet_metadata_includes_unavailable_source_reason(mock_adp, mock_players, mock_curves, mock_scrape, client):
    rows = _mock_scrape_result()
    outcomes = [
        SourceOutcome(source="FantasyPros", position=pos, rows=1, reason=None)
        for pos in ["QB", "RB", "WR", "TE", "DST"]
    ] + [SourceOutcome(source="FFToday", position="RB", rows=0, reason="HTTP 403")]
    mock_scrape.return_value = ScrapeResult(rows, outcomes=outcomes)
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    resp = client.post("/api/sheet", json={"n_teams": 12, "QB": 1, "RB": 2, "WR": 3,
                                           "TE": 1, "DST": 1, "K": 0, "flex_slots": 1})

    assert resp.status_code == 200
    meta = resp.json()["metadata"]
    statuses = {entry["source"]: entry for entry in meta["source_statuses"]}
    assert "FantasyPros" in meta["sources_used"]
    assert "FFToday" in meta["sources_dropped"]
    assert statuses["FFToday"]["status"] == "unavailable"
    assert statuses["FFToday"]["reason"] == "HTTP 403"
    assert statuses["FFToday"]["failures"] == [{"position": "RB", "reason": "HTTP 403"}]


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_sheet_metadata_marks_partial_sources_used_with_warnings(mock_adp, mock_players, mock_curves, mock_scrape, client):
    result = {pos: [] for pos in ["QB", "RB", "WR", "TE", "DST"]}
    result["RB"].append({
        "source": "FantasyPros",
        "player_name": "RBPlayer",
        "pos": "RB",
        "team": "KC",
        "sleeper_id": "rb_1",
        "espn_id": None,
        "points": 100.0,
    })
    result["WR"].append({
        "source": "FantasyPros",
        "player_name": "WRPlayer",
        "pos": "WR",
        "team": "KC",
        "sleeper_id": "wr_1",
        "espn_id": None,
        "points": 100.0,
    })
    mock_scrape.return_value = ScrapeResult(result, outcomes=[
        SourceOutcome(source="FantasyPros", position="RB", rows=1, reason=None),
        SourceOutcome(source="FantasyPros", position="WR", rows=1, reason=None),
        SourceOutcome(source="FantasyPros", position="TE", rows=0, reason="timeout"),
    ])
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    resp = client.post("/api/sheet", json={"n_teams": 12, "QB": 1, "RB": 2, "WR": 3,
                                           "TE": 1, "DST": 1, "K": 0, "flex_slots": 1})

    assert resp.status_code == 200
    meta = resp.json()["metadata"]
    statuses = {entry["source"]: entry for entry in meta["source_statuses"]}
    assert "FantasyPros" in meta["sources_used"]
    assert "FantasyPros" not in meta["sources_dropped"]
    assert statuses["FantasyPros"]["status"] == "partial"
    assert statuses["FantasyPros"]["positions"] == ["RB", "WR"]
    assert statuses["FantasyPros"]["failures"] == [{"position": "TE", "reason": "timeout"}]


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_all_sources_down_includes_unavailable_source_statuses(mock_adp, mock_players, mock_curves, mock_scrape, client):
    outcomes = [
        SourceOutcome(source="FantasyPros", position=pos, rows=0, reason="0 rows")
        for pos in ["QB", "RB", "WR", "TE", "DST"]
    ]
    mock_scrape.return_value = ScrapeResult(
        {pos: [] for pos in ["QB", "RB", "WR", "TE", "DST"]},
        outcomes=outcomes,
    )
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)

    resp = client.post("/api/sheet", json={"n_teams": 12, "QB": 1, "RB": 2, "WR": 3,
                                           "TE": 1, "DST": 1, "K": 0, "flex_slots": 1})

    assert resp.status_code == 200
    meta = resp.json()["metadata"]
    statuses = {entry["source"]: entry for entry in meta["source_statuses"]}
    assert meta["sources_used"] == []
    assert statuses["FantasyPros"]["status"] == "unavailable"
    assert statuses["FantasyPros"]["reason"] == "0 rows"


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map_async")
@patch("app.main.enrich_with_adp")
def test_cached_sheet_preserves_source_status_metadata(mock_adp, mock_players, mock_curves, mock_scrape, client):
    mock_scrape.return_value = _mock_scrape_result_with_sources(["FantasyPros"])
    mock_curves.return_value = _mock_attrition_curves()
    mock_players.return_value = {}
    mock_adp.side_effect = lambda rows, n_teams, ppr: (rows, False)
    payload = {"n_teams": 12, "QB": 1, "RB": 2, "WR": 3, "TE": 1, "DST": 1, "K": 0, "flex_slots": 1}

    first = client.post("/api/sheet", json=payload)
    second = client.post("/api/sheet", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    meta = second.json()["metadata"]
    assert meta["cache_hit"] is True
    assert meta["source_statuses"][0]["source"] in {"ESPN", "FFToday", "FantasyPros", "NumberFire"}
    assert {entry["source"] for entry in meta["source_statuses"]} >= {"FantasyPros"}


def test_legacy_cached_sheet_backfills_source_statuses_without_losing_source_names(client):
    payload = {"n_teams": 12, "QB": 1, "RB": 2, "WR": 3, "TE": 1, "DST": 1, "K": 0, "flex_slots": 1}
    from app.main import _sheet_cache_key
    from app.config import LeagueConfig

    cache.set(_sheet_cache_key(LeagueConfig(**payload)), {
        "positions": {pos: [] for pos in ["QB", "RB", "WR", "TE", "DST"]},
        "metadata": {
            "season": 2026,
            "n_teams": 12,
            "ppr": 0.5,
            "sources_used": ["FantasyPros"],
            "sources_dropped": ["FFToday"],
            "baselines": {},
            "adp_available": False,
            "cache_hit": False,
            "generation_time_s": 1.0,
        },
    })

    resp = client.post("/api/sheet", json=payload)

    assert resp.status_code == 200
    meta = resp.json()["metadata"]
    assert meta["sources_used"] == ["FantasyPros"]
    assert meta["sources_dropped"] == ["FFToday"]
    statuses = {entry["source"]: entry for entry in meta["source_statuses"]}
    assert statuses["FantasyPros"]["status"] == "used"
    assert statuses["FFToday"]["status"] == "unavailable"


def test_sheet_cache_key_includes_bench_spots():
    from app.main import _sheet_cache_key
    from app.config import LeagueConfig

    base = {
        "n_teams": 12,
        "QB": 1, "RB": 2, "WR": 3, "TE": 1, "DST": 1, "K": 0,
        "flex_slots": 1,
    }
    default_key = _sheet_cache_key(LeagueConfig(**base))
    deep_bench_key = _sheet_cache_key(LeagueConfig(**base, bench_spots=8))

    assert "_6bench_" in default_key
    assert "_8bench_" in deep_bench_key
    assert default_key != deep_bench_key


# ---- CORS header present -----------------------------------------------------

def test_cors_header_present(client):
    resp = client.options("/api/sheet", headers={"Origin": "http://localhost:5173"})
    # CORS middleware sets allow-origin header
    assert resp.headers.get("access-control-allow-origin") is not None
