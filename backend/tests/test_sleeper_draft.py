"""Tests for the Sleeper live draft provider and POST /api/draft/sleeper."""

import contextlib
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.data.players import PlayerRecord

FIXTURES = Path(__file__).parent / "fixtures"
DRAFT = json.loads((FIXTURES / "sleeper_draft.json").read_text())
PICKS = json.loads((FIXTURES / "sleeper_picks.json").read_text())
USERS = json.loads((FIXTURES / "sleeper_users.json").read_text())

# sleeper_id → PlayerRecord. "DEN" (DST) and "9999999" (kicker) are deliberately
# absent so they exercise the metadata-fallback paths.
KNOWN_PLAYERS = {
    "4034": PlayerRecord(
        sleeper_id="4034", first_name="Christian", last_name="McCaffrey",
        full_name="Christian McCaffrey", position="RB", team="SF", bye_week=9,
    ),
}


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def _json_response(payload, status_code=200, *, bad_json=False):
    resp = MagicMock()
    resp.status_code = status_code
    if bad_json:
        resp.json.side_effect = ValueError("no json")
    else:
        resp.json.return_value = payload
    return resp


def _router(draft=DRAFT, picks=PICKS, users=USERS, *, overrides=None):
    """Dispatch httpx GETs to the right fixture by URL path.

    overrides maps a path-substring → (payload, status_code, bad_json) to force
    a specific response (e.g. a 404 draft or a failing users call).
    """
    overrides = overrides or {}

    async def _get(url, *args, **kwargs):
        path = str(url)
        for needle, spec in overrides.items():
            if needle in path:
                payload, status_code, bad_json = spec
                return _json_response(payload, status_code, bad_json=bad_json)
        if "/picks" in path:
            return _json_response(picks)
        if "/users" in path:
            return _json_response(users)
        if "/draft/" in path:
            return _json_response(draft)
        raise AssertionError(f"unexpected Sleeper URL: {path}")

    return _get


@contextlib.contextmanager
def _patch(get_side_effect):
    with patch(
        "httpx.AsyncClient.get", new_callable=AsyncMock, side_effect=get_side_effect,
    ), patch(
        "app.providers.sleeper.get_player",
        side_effect=lambda pid: KNOWN_PLAYERS.get(pid),
    ), patch(
        "app.providers.sleeper.load_player_map_async", new_callable=AsyncMock,
        return_value={},
    ):
        yield


REQUEST = {"draft_id": "123456"}


# ---- happy path ----------------------------------------------------------------

def test_completed_draft_parses_and_enriches(client):
    with _patch(_router()):
        resp = client.post("/api/draft/sleeper", json=REQUEST)

    assert resp.status_code == 200
    data = resp.json()
    assert data["provider"] == "sleeper"
    assert data["complete"] is True
    assert data["in_progress"] is False
    assert data["fetched_at"] > 0

    picks = data["picks"]
    # Fixture lists picks out of order (2, 1, 3) — provider sorts by overall.
    assert [p["overall"] for p in picks] == [1, 2, 3]

    cmc = picks[0]
    assert cmc["provider_player_id"] == "4034"
    assert cmc["sleeper_id"] == "4034"
    assert cmc["player_name"] == "Christian McCaffrey"
    assert cmc["pos"] == "RB"
    assert cmc["nfl_team"] == "SF"
    assert cmc["team_id"] == "1"  # roster_id
    assert cmc["round"] == 1
    assert cmc["round_pick"] == 1

    # DST: player_id is the team abbrev, metadata position "DEF" → "DST".
    dst = picks[1]
    assert dst["pos"] == "DST"
    assert dst["player_name"] == "DEN DST"
    assert dst["nfl_team"] == "DEN"
    assert dst["sleeper_id"] is None
    assert dst["round_pick"] == 2  # (2-1) % 2 + 1

    # Unknown player (kicker) → named from pick metadata, not bridged.
    unknown = picks[2]
    assert unknown["sleeper_id"] is None
    assert unknown["player_name"] == "Harrison Butker"
    assert unknown["pos"] == "K"
    assert unknown["nfl_team"] == "KC"


def test_team_names_prefer_team_name_then_display_name(client):
    with _patch(_router()):
        resp = client.post("/api/draft/sleeper", json=REQUEST)

    teams = {t["team_id"]: t for t in resp.json()["teams"]}
    assert teams["1"]["name"] == "Team Derrick"   # metadata.team_name wins
    assert teams["2"]["name"] == "Rival Squad"     # falls back to display_name


def test_in_progress_draft(client):
    live = {**DRAFT, "status": "drafting"}
    with _patch(_router(draft=live)):
        resp = client.post("/api/draft/sleeper", json=REQUEST)

    data = resp.json()
    assert data["complete"] is False
    assert data["in_progress"] is True


def test_paused_draft_is_in_progress(client):
    with _patch(_router(draft={**DRAFT, "status": "paused"})):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    data = resp.json()
    assert data["in_progress"] is True
    assert data["complete"] is False


def test_pre_draft_is_neither(client):
    with _patch(_router(draft={**DRAFT, "status": "pre_draft"})):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    data = resp.json()
    assert data["in_progress"] is False
    assert data["complete"] is False


def test_auction_draft_parses(client):
    with _patch(_router(draft={**DRAFT, "type": "auction"})):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    assert resp.status_code == 200
    assert len(resp.json()["picks"]) == 3


# ---- mock drafts (no league_id) -----------------------------------------------

def test_mock_draft_without_league_id_skips_users_and_falls_back(client):
    mock_draft = {**DRAFT, "league_id": None, "draft_order": None, "status": "drafting"}

    # The standard router, but /users raises so we prove it is never fetched.
    async def _get(url, *args, **kwargs):
        path = str(url)
        if "/users" in path:
            raise AssertionError("users must not be fetched for a mock draft")
        if "/picks" in path:
            return _json_response(PICKS)
        if "/draft/" in path:
            return _json_response(mock_draft)
        raise AssertionError(f"unexpected URL: {path}")

    with _patch(_get):
        resp = client.post("/api/draft/sleeper", json=REQUEST)

    assert resp.status_code == 200
    data = resp.json()
    teams = {t["team_id"]: t["name"] for t in data["teams"]}
    assert teams == {"1": "Team 1", "2": "Team 2"}
    assert len(data["picks"]) == 3


def test_users_failure_degrades_gracefully(client):
    # /users returns 500 → best-effort path swallows it, draft still parses.
    with _patch(_router(overrides={"/users": ({}, 500, False)})):
        resp = client.post("/api/draft/sleeper", json=REQUEST)

    assert resp.status_code == 200
    data = resp.json()
    # Names fall back to "Team N" since users couldn't be loaded.
    assert {t["name"] for t in data["teams"]} == {"Team 1", "Team 2"}


# ---- error mapping -------------------------------------------------------------

def test_unknown_draft_id_maps_to_404(client):
    # Sleeper answers a bad draft id with 404 + null body.
    with _patch(_router(overrides={"/draft/123456": (None, 404, False)})):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    assert resp.status_code == 404


def test_non_dict_draft_payload_is_schema_error(client):
    with _patch(_router(draft={"foo": "bar"})):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    assert resp.status_code == 502


def test_non_json_draft_maps_to_502(client):
    with _patch(_router(overrides={"/draft/123456": (None, 200, True)})):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    assert resp.status_code == 502


def test_upstream_500_maps_to_502(client):
    with _patch(_router(overrides={"/draft/123456": ({}, 500, False)})):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    assert resp.status_code == 502


def test_timeout_maps_to_504(client):
    async def _timeout(url, *args, **kwargs):
        raise httpx.ConnectTimeout("timed out")

    with _patch(_timeout):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    assert resp.status_code == 504


def test_request_error_maps_to_502(client):
    async def _boom(url, *args, **kwargs):
        raise httpx.ConnectError("no route")

    with _patch(_boom):
        resp = client.post("/api/draft/sleeper", json=REQUEST)
    assert resp.status_code == 502


def test_empty_draft_id_rejected(client):
    resp = client.post("/api/draft/sleeper", json={"draft_id": ""})
    assert resp.status_code == 422
