"""Integration tests for /api/sheet and /health endpoints (U10)."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock, MagicMock

from app.main import app
from app import cache


@pytest.fixture(autouse=True)
def clear_cache():
    """Ensure cache is clean before each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client():
    return TestClient(app)


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
            pts = 350.0 - i * 15 if pos == "QB" else 300.0 - i * 10
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
    return result


def _mock_attrition_curves():
    return {pos: [14.0] * 80 for pos in ["QB", "RB", "WR", "TE", "DST", "K"]}


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map")
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


@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map")
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
@patch("app.main.load_player_map")
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


# ---- all-sources-down graceful degradation -----------------------------------

@patch("app.main.scrape_all", new_callable=AsyncMock)
@patch("app.main.load_attrition_curves")
@patch("app.main.load_player_map")
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


# ---- CORS header present -----------------------------------------------------

def test_cors_header_present(client):
    resp = client.options("/api/sheet", headers={"Origin": "http://localhost:5173"})
    # CORS middleware sets allow-origin header
    assert resp.headers.get("access-control-allow-origin") is not None
