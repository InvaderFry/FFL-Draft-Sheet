"""Tests for the ESPN player directory fallback (data/espn_players.py)."""

import json
import time
from unittest.mock import MagicMock

import httpx
import pytest

from app import cache
from app.data import espn_players

SEASON = 2025

PAYLOAD = [
    {"id": 9999999, "fullName": "Saquon Barkley", "defaultPositionId": 2, "proTeamId": 21},
    {"id": 4360234, "fullName": "Harrison Butker", "defaultPositionId": 5, "proTeamId": 12},
    {"id": 123, "defaultPositionId": 1},  # no fullName → skipped
    "not-a-dict",  # malformed entry → skipped
]


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    """Fresh memo/failure state and a temp cache dir for every test."""
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(espn_players, "_directories", {})
    monkeypatch.setattr(espn_players, "_failed_at", {})


def _ok_response(payload=None):
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = PAYLOAD if payload is None else payload
    return resp


def test_parses_directory_and_sends_no_cookies(monkeypatch):
    get_mock = MagicMock(return_value=_ok_response())
    monkeypatch.setattr(espn_players.httpx, "get", get_mock)

    directory = espn_players.load_espn_directory(SEASON)

    assert directory == {
        "9999999": {"name": "Saquon Barkley", "pos": "RB", "team": "PHI"},
        "4360234": {"name": "Harrison Butker", "pos": "K", "team": "KC"},
    }
    kwargs = get_mock.call_args.kwargs
    assert str(SEASON) in get_mock.call_args.args[0]
    assert json.loads(kwargs["headers"]["x-fantasy-filter"]) == {
        "filterActive": {"value": True}
    }
    # League-independent endpoint: nothing credential-shaped may be sent.
    assert "cookies" not in kwargs

    # Second call is memoized — no refetch.
    assert espn_players.load_espn_directory(SEASON) is directory
    assert get_mock.call_count == 1


def test_unexpected_payload_shape_is_a_failure(monkeypatch):
    monkeypatch.setattr(
        espn_players.httpx, "get",
        MagicMock(return_value=_ok_response(payload={"players": []})),
    )
    assert espn_players.load_espn_directory(SEASON) == {}
    assert SEASON in espn_players._failed_at


def test_failure_returns_empty_then_retries_after_cooldown(monkeypatch):
    get_mock = MagicMock(side_effect=httpx.ConnectError("espn down"))
    monkeypatch.setattr(espn_players.httpx, "get", get_mock)

    assert espn_players.load_espn_directory(SEASON) == {}
    assert SEASON not in espn_players._directories  # failure not memoized

    # Within the cooldown the empty result is served without a refetch.
    assert espn_players.load_espn_directory(SEASON) == {}
    assert get_mock.call_count == 1

    # After the cooldown the next call retries and recovers.
    espn_players._failed_at[SEASON] = time.time() - espn_players.RETRY_COOLDOWN - 1
    get_mock.side_effect = None
    get_mock.return_value = _ok_response()
    directory = espn_players.load_espn_directory(SEASON)
    assert directory["9999999"]["name"] == "Saquon Barkley"
    assert SEASON not in espn_players._failed_at


def test_file_cache_round_trip(monkeypatch):
    get_mock = MagicMock(return_value=_ok_response())
    monkeypatch.setattr(espn_players.httpx, "get", get_mock)
    first = espn_players.load_espn_directory(SEASON)

    # New process simulation: memo gone, file cache still present.
    espn_players._directories.clear()
    second = espn_players.load_espn_directory(SEASON)
    assert second == first
    assert get_mock.call_count == 1
