"""Tests for data/scraper.py adapter plumbing (U3)."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.data import scraper
from app import cache


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()
    yield
    cache.clear()


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
async def test_fftoday_url_uses_config_season(make_league):
    captured = {}
    client = _mock_client(captured)
    rows = await scraper._fetch_fftoday(client, "RB", make_league(season=2027))
    assert rows == []
    assert "Season=2027" in captured["url"]


@pytest.mark.asyncio
async def test_espn_url_uses_config_season(make_league):
    captured = {}
    client = _mock_client(captured)
    rows = await scraper._fetch_espn(client, "RB", make_league(season=2028))
    assert rows == []
    assert "/seasons/2028/" in captured["url"]


@pytest.mark.asyncio
async def test_adapters_accept_full_league_config(make_league):
    """Every adapter must accept a LeagueConfig (not just ScoringConfig)."""
    captured = {}
    client = _mock_client(captured)
    cfg = make_league()
    for fn in scraper.ADAPTERS.values():
        rows = await fn(client, "RB", cfg)
        assert rows == []  # empty responses parse to no rows, no exceptions


@pytest.mark.asyncio
async def test_scrape_position_records_success_outcome(make_league, monkeypatch):
    async def fake_adapter(client, pos, cfg):
        return [{
            "source": "FantasyPros",
            "player_name": "Player",
            "pos": pos,
            "team": "KC",
            "sleeper_id": "player_1",
            "points": 12.0,
        }]

    monkeypatch.setitem(scraper.ADAPTERS, "FantasyPros", fake_adapter)

    rows = await scraper.scrape_position("RB", make_league(), sources=["FantasyPros"])

    assert rows[0]["player_name"] == "Player"
    assert rows.outcomes == [
        scraper.SourceOutcome(
            source="FantasyPros",
            position="RB",
            rows=1,
            reason=None,
        )
    ]


@pytest.mark.asyncio
async def test_scrape_position_records_http_error_outcome(make_league, monkeypatch):
    async def failing_adapter(client, pos, cfg):
        request = httpx.Request("GET", "https://example.test/projections")
        response = httpx.Response(403, request=request)
        raise httpx.HTTPStatusError("Forbidden at private URL", request=request, response=response)

    monkeypatch.setitem(scraper.ADAPTERS, "FFToday", failing_adapter)

    rows = await scraper.scrape_position("RB", make_league(), sources=["FFToday"])

    assert rows == []
    assert rows.outcomes == [
        scraper.SourceOutcome(
            source="FFToday",
            position="RB",
            rows=0,
            reason="HTTP 403",
        )
    ]


@pytest.mark.asyncio
async def test_scrape_position_sanitizes_timeout_and_generic_failures(make_league, monkeypatch):
    async def timeout_adapter(client, pos, cfg):
        raise httpx.TimeoutException("timed out requesting https://secret.example/path")

    async def generic_adapter(client, pos, cfg):
        raise RuntimeError("token=secret long traceback details")

    monkeypatch.setitem(scraper.ADAPTERS, "FantasyPros", timeout_adapter)
    monkeypatch.setitem(scraper.ADAPTERS, "NumberFire", generic_adapter)

    rows = await scraper.scrape_position("RB", make_league(), sources=["FantasyPros", "NumberFire"])

    assert rows == []
    assert [outcome.reason for outcome in rows.outcomes] == ["timeout", "parse error"]


@pytest.mark.asyncio
async def test_scrape_position_records_zero_rows_and_unsupported_source(make_league, monkeypatch):
    async def empty_adapter(client, pos, cfg):
        return []

    monkeypatch.setitem(scraper.ADAPTERS, "FantasyPros", empty_adapter)

    rows = await scraper.scrape_position("DST", make_league(), sources=["FantasyPros", "FFToday"])

    assert rows == []
    assert rows.outcomes == [
        scraper.SourceOutcome(
            source="FantasyPros",
            position="DST",
            rows=0,
            reason="0 rows",
        ),
        scraper.SourceOutcome(
            source="FFToday",
            position="DST",
            rows=0,
            reason="unsupported",
        ),
    ]


@pytest.mark.asyncio
async def test_scrape_all_preserves_rows_and_outcomes_by_position(make_league, monkeypatch):
    async def fake_scrape_position(pos, cfg, sources=None):
        rows = scraper.ScrapeRows([{"source": "FantasyPros", "player_name": pos, "pos": pos, "points": 1.0}])
        rows.outcomes = [
            scraper.SourceOutcome(source="FantasyPros", position=pos, rows=1, reason=None)
        ]
        return rows

    monkeypatch.setattr(scraper, "scrape_position", fake_scrape_position)

    result = await scraper.scrape_all(make_league(), sources=["FantasyPros"])

    assert result["QB"][0]["player_name"] == "QB"
    assert result.outcomes[0] == scraper.SourceOutcome(
        source="FantasyPros",
        position="QB",
        rows=1,
        reason=None,
    )
