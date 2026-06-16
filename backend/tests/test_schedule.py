"""Tests for the ESPN team-bye loader (data/schedule.py)."""

from unittest.mock import MagicMock

import httpx
import pytest

from app import cache
from app.data import schedule

SEASON = 2026

PAYLOAD = {
    "settings": {
        "proTeams": [
            {"abbrev": "BUF", "byeWeek": 7},
            {"abbrev": "WSH", "byeWeek": 12},   # ESPN spelling → WAS
            {"abbrev": "JAX", "byeWeek": 8},    # ESPN spelling → JAC
            {"abbrev": "LAR", "byeWeek": 6},    # ESPN spelling → LA
            {"abbrev": "FA", "byeWeek": 0},     # free-agent placeholder → skipped
            {"abbrev": "KC"},                   # missing byeWeek → skipped
            "not-a-dict",                       # malformed → skipped
        ]
    }
}


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")


def _resp(payload):
    r = MagicMock()
    r.raise_for_status.return_value = None
    r.json.return_value = payload
    return r


def test_builds_normalized_bye_map(monkeypatch):
    monkeypatch.setattr(schedule.httpx, "get", MagicMock(return_value=_resp(PAYLOAD)))

    result = schedule.load_team_byes(SEASON)

    assert result == {"BUF": 7, "WAS": 12, "JAC": 8, "LA": 6}
    # placeholders / missing byes are dropped
    assert "FA" not in result and "KC" not in result


def test_fetch_failure_returns_empty(monkeypatch):
    monkeypatch.setattr(
        schedule.httpx, "get", MagicMock(side_effect=httpx.ConnectError("espn down")),
    )
    assert schedule.load_team_byes(SEASON) == {}


def test_empty_proteams_returns_empty(monkeypatch):
    monkeypatch.setattr(
        schedule.httpx, "get", MagicMock(return_value=_resp({"settings": {"proTeams": []}})),
    )
    assert schedule.load_team_byes(SEASON) == {}


def test_result_is_cached(monkeypatch):
    get_mock = MagicMock(return_value=_resp(PAYLOAD))
    monkeypatch.setattr(schedule.httpx, "get", get_mock)

    first = schedule.load_team_byes(SEASON)
    second = schedule.load_team_byes(SEASON)

    assert first == second
    assert get_mock.call_count == 1  # second call served from cache
