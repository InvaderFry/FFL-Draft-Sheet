"""Tests for data/scraper.py adapter plumbing (U3)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.config import LeagueConfig
from app.data import scraper


def _league(season=2026):
    return LeagueConfig(season=season, QB=1, RB=2, WR=3, TE=1, DST=1, K=0, flex_slots=1)


def _mock_client(captured):
    """Return an AsyncMock httpx client that records the URL/params it is called with."""
    async def _get(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        resp = MagicMock()
        resp.status_code = 200
        resp.text = ""              # empty HTML → parser returns []
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={"players": []})
        return resp

    client = MagicMock()
    client.get = AsyncMock(side_effect=_get)
    return client


@pytest.mark.asyncio
async def test_fftoday_url_uses_config_season():
    captured = {}
    client = _mock_client(captured)
    rows = await scraper._fetch_fftoday(client, "RB", _league(season=2027))
    assert rows == []
    assert "Season=2027" in captured["url"]


@pytest.mark.asyncio
async def test_espn_url_uses_config_season():
    captured = {}
    client = _mock_client(captured)
    rows = await scraper._fetch_espn(client, "RB", _league(season=2028))
    assert rows == []
    assert "/seasons/2028/" in captured["url"]


@pytest.mark.asyncio
async def test_adapters_accept_full_league_config():
    """Every adapter must accept a LeagueConfig (not just ScoringConfig)."""
    captured = {}
    client = _mock_client(captured)
    cfg = _league()
    for fn in scraper.ADAPTERS.values():
        rows = await fn(client, "RB", cfg)
        assert rows == []  # empty responses parse to no rows, no exceptions
