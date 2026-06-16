"""Tests for the FFC ADP loader + dual-source enrichment (data/adp.py)."""

from unittest.mock import MagicMock

import httpx
import pytest

from app import cache
from app.data import adp

SEASON = 2026


def _players(n: int, start: int = 1) -> dict:
    """An FFC-shaped response with n players carrying real espn_ids."""
    return {"players": [
        {"espn_id": 1000 + i, "name": f"P{i}", "position": "RB", "team": "KC"}
        for i in range(start, start + n)
    ]}


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")


def _resp(payload):
    r = MagicMock()
    r.raise_for_status.return_value = None
    r.json.return_value = payload
    return r


def test_fetch_adp_passes_year(monkeypatch):
    get_mock = MagicMock(return_value=_resp(_players(50)))
    monkeypatch.setattr(adp.httpx, "get", get_mock)

    result = adp.fetch_adp(n_teams=12, ppr=1.0, season=SEASON)

    assert get_mock.call_args.kwargs["params"]["year"] == SEASON
    assert len(result) == 50
    assert all(info["adp_season"] == SEASON for info in result.values())


def test_prior_year_fallback_when_current_sparse(monkeypatch):
    # Current season returns too few players; prior season is full.
    def fake_get(url, params=None, **kwargs):
        if params.get("year") == SEASON:
            return _resp(_players(3))           # sparse → triggers fallback
        return _resp(_players(50, start=100))   # prior season is healthy
    monkeypatch.setattr(adp.httpx, "get", MagicMock(side_effect=fake_get))

    result = adp.fetch_adp(n_teams=12, ppr=1.0, season=SEASON)

    assert len(result) == 50
    assert all(info["adp_season"] == SEASON - 1 for info in result.values())


def test_fetch_failure_returns_empty(monkeypatch):
    monkeypatch.setattr(
        adp.httpx, "get", MagicMock(side_effect=httpx.ConnectError("ffc down")),
    )
    assert adp.fetch_adp(n_teams=12, ppr=0.5, season=SEASON) == {}


def test_enrich_prefers_ecr_over_adp(monkeypatch):
    monkeypatch.setattr(adp, "fetch_adp", lambda n, ppr, season: {
        "5001": {"adp_rank": 7, "player_name": "A", "pos": "RB", "team": "KC"},
    })
    monkeypatch.setattr(adp.ecr, "fetch_ecr", lambda season, ppr: {"sid_a": 3})

    rows = [{"espn_id": "5001", "sleeper_id": "sid_a"}]
    enriched, adp_avail, ecr_avail = adp.enrich_with_adp(rows, n_teams=12, ppr=0.5, season=SEASON)

    assert adp_avail is True and ecr_avail is True
    assert enriched[0]["adp_rank"] == 7
    assert enriched[0]["ecr_rank"] == 3            # real ECR wins
    assert enriched[0]["ecr_fmt"] == "1|03"


def test_enrich_falls_back_to_adp_as_ecr_proxy(monkeypatch):
    monkeypatch.setattr(adp, "fetch_adp", lambda n, ppr, season: {
        "5001": {"adp_rank": 7, "player_name": "A", "pos": "RB", "team": "KC"},
    })
    monkeypatch.setattr(adp.ecr, "fetch_ecr", lambda season, ppr: {})  # no ECR

    rows = [{"espn_id": "5001", "sleeper_id": "sid_a"}]
    enriched, adp_avail, ecr_avail = adp.enrich_with_adp(rows, n_teams=12, ppr=0.5, season=SEASON)

    assert adp_avail is True and ecr_avail is False
    assert enriched[0]["ecr_rank"] == 7            # proxied from ADP
    assert enriched[0]["ecr_fmt"] == "1|07"


def test_enrich_unmatched_player_is_blank(monkeypatch):
    monkeypatch.setattr(adp, "fetch_adp", lambda n, ppr, season: {})
    monkeypatch.setattr(adp.ecr, "fetch_ecr", lambda season, ppr: {})

    rows = [{"espn_id": "9999", "sleeper_id": "nope"}]
    enriched, adp_avail, ecr_avail = adp.enrich_with_adp(rows, n_teams=12, ppr=0.5, season=SEASON)

    assert adp_avail is False and ecr_avail is False
    assert enriched[0]["adp_rank"] is None
    assert enriched[0]["ecr_rank"] is None
    assert enriched[0]["ecr_fmt"] == "—"
