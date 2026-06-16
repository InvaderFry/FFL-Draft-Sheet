"""Tests for the FantasyPros ECR loader (data/ecr.py)."""

from unittest.mock import MagicMock

import httpx
import pytest

from app import cache
from app.data import ecr
from app.data.players import PlayerRecord

SEASON = 2026

PAYLOAD = {
    "players": [
        {"player_name": "Ja'Marr Chase", "player_position_id": "WR",
         "player_team_id": "CIN", "rank_ecr": 1},
        {"player_name": "Bijan Robinson", "player_position_id": "RB",
         "player_team_id": "ATL", "rank_ecr": 2},
        {"player_name": "No Rank Guy", "player_position_id": "WR",
         "player_team_id": "KC"},  # missing rank_ecr → skipped
        "not-a-dict",  # malformed → skipped
    ]
}


def _rec(sleeper_id: str) -> PlayerRecord:
    return PlayerRecord(
        sleeper_id=sleeper_id,
        first_name="X", last_name="Y", full_name="X Y",
        position="WR", team="CIN", bye_week=None,
    )


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    """Fresh temp cache dir and a clean API-key env for every test."""
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.delenv(ecr.API_KEY_ENV, raising=False)


def _ok_response(payload=None):
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = PAYLOAD if payload is None else payload
    return resp


def test_no_api_key_returns_empty(monkeypatch):
    get_mock = MagicMock(return_value=_ok_response())
    monkeypatch.setattr(ecr.httpx, "get", get_mock)
    assert ecr.fetch_ecr(SEASON, ppr=0.5) == {}
    get_mock.assert_not_called()


def test_parses_rankings_keyed_by_sleeper_id(monkeypatch):
    monkeypatch.setenv(ecr.API_KEY_ENV, "test-key")
    get_mock = MagicMock(return_value=_ok_response())
    monkeypatch.setattr(ecr.httpx, "get", get_mock)
    # Each resolvable player maps to a deterministic sleeper id.
    monkeypatch.setattr(
        ecr, "find_player",
        lambda name, pos, team: _rec(f"sid_{name.split()[0]}"),
    )

    result = ecr.fetch_ecr(SEASON, ppr=1.0)

    assert result == {"sid_Ja'Marr": 1, "sid_Bijan": 2}
    kwargs = get_mock.call_args.kwargs
    assert kwargs["headers"]["x-api-key"] == "test-key"
    assert kwargs["params"]["scoring"] == "PPR"
    assert str(SEASON) in get_mock.call_args.args[0]


def test_half_ppr_scoring_code(monkeypatch):
    monkeypatch.setenv(ecr.API_KEY_ENV, "test-key")
    get_mock = MagicMock(return_value=_ok_response({"players": []}))
    monkeypatch.setattr(ecr.httpx, "get", get_mock)
    ecr.fetch_ecr(SEASON, ppr=0.5)
    assert get_mock.call_args.kwargs["params"]["scoring"] == "HALF"


def test_unresolvable_player_is_skipped(monkeypatch):
    monkeypatch.setenv(ecr.API_KEY_ENV, "test-key")
    monkeypatch.setattr(ecr.httpx, "get", MagicMock(return_value=_ok_response()))
    monkeypatch.setattr(ecr, "find_player", lambda name, pos, team: None)
    assert ecr.fetch_ecr(SEASON, ppr=0.5) == {}


def test_explicit_api_key_works_without_env(monkeypatch):
    # No env var set (cleared by the fixture); an explicit key still fetches.
    get_mock = MagicMock(return_value=_ok_response())
    monkeypatch.setattr(ecr.httpx, "get", get_mock)
    monkeypatch.setattr(ecr, "find_player", lambda name, pos, team: _rec(f"sid_{name.split()[0]}"))

    result = ecr.fetch_ecr(SEASON, ppr=1.0, api_key="request-key")

    assert result == {"sid_Ja'Marr": 1, "sid_Bijan": 2}
    assert get_mock.call_args.kwargs["headers"]["x-api-key"] == "request-key"


def test_explicit_api_key_takes_precedence_over_env(monkeypatch):
    monkeypatch.setenv(ecr.API_KEY_ENV, "env-key")
    get_mock = MagicMock(return_value=_ok_response({"players": []}))
    monkeypatch.setattr(ecr.httpx, "get", get_mock)

    ecr.fetch_ecr(SEASON, ppr=0.5, api_key="request-key")

    assert get_mock.call_args.kwargs["headers"]["x-api-key"] == "request-key"


def test_http_error_returns_empty(monkeypatch):
    monkeypatch.setenv(ecr.API_KEY_ENV, "test-key")
    monkeypatch.setattr(
        ecr.httpx, "get", MagicMock(side_effect=httpx.ConnectError("fp down")),
    )
    assert ecr.fetch_ecr(SEASON, ppr=0.5) == {}


def test_file_cache_round_trip(monkeypatch):
    monkeypatch.setenv(ecr.API_KEY_ENV, "test-key")
    get_mock = MagicMock(return_value=_ok_response())
    monkeypatch.setattr(ecr.httpx, "get", get_mock)
    monkeypatch.setattr(ecr, "find_player", lambda name, pos, team: _rec(f"sid_{name.split()[0]}"))

    first = ecr.fetch_ecr(SEASON, ppr=1.0)
    second = ecr.fetch_ecr(SEASON, ppr=1.0)  # served from cache
    assert second == first
    assert get_mock.call_count == 1
