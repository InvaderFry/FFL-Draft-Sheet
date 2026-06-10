"""Tests for the ESPN live draft provider and POST /api/draft/espn."""

import contextlib
import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.data.players import PlayerRecord

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "espn_mdraftdetail.json").read_text()
)

# espn_id → PlayerRecord stand-ins for the Sleeper map
KNOWN_PLAYERS = {
    "3929630": PlayerRecord(
        sleeper_id="4034", first_name="Christian", last_name="McCaffrey",
        full_name="Christian McCaffrey", position="RB", team="SF",
        bye_week=9, espn_id="3929630",
    ),
    "4262921": PlayerRecord(
        sleeper_id="6794", first_name="Justin", last_name="Jefferson",
        full_name="Justin Jefferson", position="WR", team="MIN",
        bye_week=6, espn_id="4262921",
    ),
}


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def _mock_response(status_code=200, payload=None):
    resp = MagicMock()
    resp.status_code = status_code
    if payload is not None:
        resp.json.return_value = payload
    else:
        resp.json.side_effect = ValueError("no json")
    return resp


def _patch_espn(status_code=200, payload=None):
    return patch(
        "httpx.AsyncClient.get",
        new_callable=AsyncMock,
        return_value=_mock_response(status_code, payload),
    )


@contextlib.contextmanager
def _patch_players():
    with patch(
        "app.providers.espn.get_player_by_espn_id",
        side_effect=lambda eid: KNOWN_PLAYERS.get(eid),
    ), patch("app.providers.espn.load_player_map_async", return_value={}):
        yield


REQUEST = {"league_id": 12345678, "season": 2025}


# ---- happy path ----------------------------------------------------------------

def test_completed_draft_parses_and_enriches(client):
    with _patch_espn(payload=FIXTURE), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)

    assert resp.status_code == 200
    data = resp.json()
    assert data["provider"] == "espn"
    assert data["complete"] is True
    assert data["in_progress"] is False
    assert data["fetched_at"] > 0

    picks = data["picks"]
    assert [p["overall"] for p in picks] == [1, 2, 3, 4]

    cmc = picks[0]
    assert cmc["provider_player_id"] == "3929630"
    assert cmc["sleeper_id"] == "4034"
    assert cmc["player_name"] == "Christian McCaffrey"
    assert cmc["pos"] == "RB"
    assert cmc["nfl_team"] == "SF"
    assert cmc["team_id"] == "4"
    assert cmc["round"] == 1
    assert cmc["round_pick"] == 1

    # Negative playerId → decoded D/ST (-16003 → CHI)
    dst = picks[2]
    assert dst["pos"] == "DST"
    assert dst["player_name"] == "CHI DST"
    assert dst["nfl_team"] == "CHI"
    assert dst["sleeper_id"] is None

    # Unknown playerId → pick still returned, just unidentified
    unknown = picks[3]
    assert unknown["provider_player_id"] == "9999999"
    assert unknown["sleeper_id"] is None
    assert unknown["player_name"] is None


def test_team_names_with_location_nickname_fallback(client):
    with _patch_espn(payload=FIXTURE), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)

    teams = {t["team_id"]: t for t in resp.json()["teams"]}
    assert teams["4"]["name"] == "Team Derrick"
    assert teams["7"]["name"] == "Old School Squad"  # empty "name" → location+nickname
    assert teams["7"]["abbrev"] == "OLD"


def test_in_progress_draft(client):
    live = json.loads(json.dumps(FIXTURE))
    live["draftDetail"]["drafted"] = False
    live["draftDetail"]["inProgress"] = True
    live["draftDetail"]["picks"] = live["draftDetail"]["picks"][:2]

    with _patch_espn(payload=live), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)

    data = resp.json()
    assert data["complete"] is False
    assert data["in_progress"] is True
    assert len(data["picks"]) == 2


# ---- cookie forwarding -----------------------------------------------------------

def test_cookies_forwarded_to_espn(client):
    with _patch_espn(payload=FIXTURE) as mock_get, _patch_players():
        client.post("/api/draft/espn", json={
            **REQUEST, "espn_s2": "s2-secret-value", "swid": "{SWID-VALUE}",
        })
    kwargs = mock_get.call_args.kwargs
    assert kwargs["cookies"] == {"espn_s2": "s2-secret-value", "SWID": "{SWID-VALUE}"}


def test_no_cookies_when_absent(client):
    with _patch_espn(payload=FIXTURE) as mock_get, _patch_players():
        client.post("/api/draft/espn", json=REQUEST)
    assert mock_get.call_args.kwargs["cookies"] is None


def test_cookies_never_logged(client, caplog):
    with caplog.at_level(logging.DEBUG):
        with _patch_espn(payload=FIXTURE), _patch_players():
            client.post("/api/draft/espn", json={
                **REQUEST, "espn_s2": "s2-secret-value", "swid": "{SWID-VALUE}",
            })
    assert "s2-secret-value" not in caplog.text
    assert "SWID-VALUE" not in caplog.text
    assert "has_cookies=True" in caplog.text


# ---- error mapping ---------------------------------------------------------------

@pytest.mark.parametrize("espn_status,api_status", [(401, 401), (403, 401), (404, 404), (500, 502)])
def test_espn_http_errors_mapped(client, espn_status, api_status):
    with _patch_espn(status_code=espn_status, payload={}), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)
    assert resp.status_code == api_status
    assert "detail" in resp.json()


def test_missing_draft_detail_is_schema_error(client):
    with _patch_espn(payload={"messages": ["You are not authorized"]}), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)
    assert resp.status_code == 502


def test_timeout_maps_to_504(client):
    import httpx
    with patch(
        "httpx.AsyncClient.get",
        new_callable=AsyncMock,
        side_effect=httpx.ConnectTimeout("timed out"),
    ), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)
    assert resp.status_code == 504


def test_league_history_list_wrapper(client):
    with _patch_espn(payload=[FIXTURE]), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)
    assert resp.status_code == 200
    assert len(resp.json()["picks"]) == 4
