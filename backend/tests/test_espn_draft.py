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
def _patch_players(directory=None):
    """Stub the Sleeper map and the ESPN player-directory fallback.

    The directory defaults to empty so existing tests keep their
    "unknown pick stays unidentified" expectations; yields the directory
    mock so tests can assert on or break it.
    """
    directory_mock = AsyncMock(return_value=directory or {})
    with patch(
        "app.providers.espn.get_player_by_espn_id",
        side_effect=lambda eid: KNOWN_PLAYERS.get(eid),
    ), patch("app.providers.espn.load_player_map_async", return_value={}), patch(
        "app.providers.espn.load_espn_directory_async", directory_mock,
    ):
        yield directory_mock


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


def test_unknown_pick_resolved_via_espn_directory(client):
    """A pick the Sleeper bridge misses gets named from ESPN's own directory."""
    directory = {"9999999": {"name": "Saquon Barkley", "pos": "RB", "team": "PHI"}}
    with _patch_espn(payload=FIXTURE), _patch_players(directory=directory):
        resp = client.post("/api/draft/espn", json=REQUEST)

    pick = resp.json()["picks"][3]
    assert pick["player_name"] == "Saquon Barkley"
    assert pick["pos"] == "RB"
    assert pick["nfl_team"] == "PHI"
    assert pick["sleeper_id"] is None  # named, but not bridged to Sleeper


def test_directory_failure_degrades_gracefully(client):
    """The draft data is fine even if the directory fetch blows up — the
    unknown pick just stays unidentified, exactly as before the fallback."""
    with _patch_espn(payload=FIXTURE), _patch_players() as directory_mock:
        directory_mock.side_effect = Exception("espn players endpoint down")
        resp = client.post("/api/draft/espn", json=REQUEST)

    assert resp.status_code == 200
    pick = resp.json()["picks"][3]
    assert pick["player_name"] is None


def test_directory_not_fetched_when_all_picks_resolve(client):
    """Zero extra ESPN traffic when the Sleeper bridge covers every pick."""
    known_only = json.loads(json.dumps(FIXTURE))
    known_only["draftDetail"]["picks"] = known_only["draftDetail"]["picks"][:3]

    with _patch_espn(payload=known_only), _patch_players() as directory_mock:
        resp = client.post("/api/draft/espn", json=REQUEST)

    assert len(resp.json()["picks"]) == 3
    directory_mock.assert_not_awaited()


def test_team_names_with_location_nickname_fallback(client):
    with _patch_espn(payload=FIXTURE), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)

    teams = {t["team_id"]: t for t in resp.json()["teams"]}
    assert teams["4"]["name"] == "Team Derrick"
    assert teams["7"]["name"] == "Old School Squad"  # empty "name" → location+nickname
    assert teams["7"]["abbrev"] == "OLD"


def test_pre_draft_placeholder_slots_are_not_picks(client):
    """Before the draft, ESPN pre-populates every pick slot with a
    placeholder playerId (0 / -1) — none of those are real picks."""
    pending = json.loads(json.dumps(FIXTURE))
    pending["draftDetail"]["drafted"] = False
    pending["draftDetail"]["inProgress"] = False
    for slot in pending["draftDetail"]["picks"]:
        slot["playerId"] = -1
    pending["draftDetail"]["picks"][1]["playerId"] = 0

    with _patch_espn(payload=pending), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)

    data = resp.json()
    assert data["picks"] == []
    assert data["complete"] is False
    assert data["in_progress"] is False


def test_live_draft_skips_unmade_slots_keeps_made_picks(client):
    """Mid-draft the picks list mixes real picks with placeholder slots —
    only the made picks (including D/ST) come through."""
    live = json.loads(json.dumps(FIXTURE))
    live["draftDetail"]["drafted"] = False
    live["draftDetail"]["inProgress"] = True
    live["draftDetail"]["picks"][3]["playerId"] = -1  # not yet picked

    with _patch_espn(payload=live), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)

    picks = resp.json()["picks"]
    assert [p["overall"] for p in picks] == [1, 2, 3]
    assert picks[2]["pos"] == "DST"  # real negative-id pick survives the filter


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


def _mock_lobby_payload(owner_swid=None):
    payload = json.loads(json.dumps(FIXTURE))
    payload["settings"] = {"draftSettings": {"leagueSubType": "MOCKDRAFT_LOBBY"}}
    if owner_swid:
        payload["teams"][0]["owners"] = [owner_swid]
    return payload


def test_mock_lobby_league_rejected_with_400(client):
    """ESPN never publishes Mock Draft Lobby picks to the read API, so a
    MOCKDRAFT_LOBBY league without cookies fails fast instead of polling
    forever (the WebSocket path needs the cookies to join the room)."""
    with _patch_espn(payload=_mock_lobby_payload()), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)

    assert resp.status_code == 400
    assert "Mock Draft Lobby" in resp.json()["detail"]
    assert "Practice replay" in resp.json()["detail"]


def test_mock_lobby_with_unknown_swid_rejected_with_400(client):
    """Cookies whose SWID owns no team in the mock league can't join its room."""
    payload = _mock_lobby_payload(owner_swid="{SOMEONE-ELSE}")
    with _patch_espn(payload=payload), _patch_players():
        resp = client.post("/api/draft/espn", json={
            **REQUEST, "espn_s2": "s2-secret", "swid": "{SWID-VALUE}",
        })
    assert resp.status_code == 400


def test_mock_lobby_with_cookies_served_from_ws_session(client):
    """Mock league + cookies + SWID-owned team routes to the draft-room
    socket session; the poll response is the session's snapshot."""
    from app.providers.base import DraftStatus

    payload = _mock_lobby_payload(owner_swid="{SWID-VALUE}")
    session = MagicMock()
    session.status.return_value = DraftStatus(
        provider="espn", in_progress=True, complete=False,
        picks=[], teams=[], fetched_at=1.0,
    )

    with _patch_espn(payload=payload), _patch_players(), patch(
        "app.providers.espn_ws.get_or_create", return_value=session,
    ) as get_or_create:
        resp = client.post("/api/draft/espn", json={
            **REQUEST, "espn_s2": "s2-secret", "swid": "{swid-value}",  # case-insensitive
        })

    assert resp.status_code == 200
    assert resp.json()["in_progress"] is True
    lobby = get_or_create.call_args.args[0]
    assert lobby.team_id == 4  # fixture team owned by the SWID
    assert lobby.league_id == REQUEST["league_id"]
    assert lobby.teams[0].name == "Team Derrick"


@pytest.mark.parametrize("espn_status", [401, 403, 500])
def test_draft_security_http_errors_mapped(espn_status):
    """fetch_draft_security maps ESPN failures onto the shared error taxonomy."""
    import asyncio
    from app.providers import espn as espn_provider

    with _patch_espn(status_code=espn_status, payload={}):
        with pytest.raises(espn_provider.EspnError):
            asyncio.run(espn_provider.fetch_draft_security(
                1242111363, 2026, 12, espn_s2="s2", swid="{S}",
            ))


def test_draft_security_returns_bare_int_token():
    import asyncio
    from app.providers import espn as espn_provider

    with _patch_espn(payload=1821426335) as mock_get:
        token = asyncio.run(espn_provider.fetch_draft_security(
            1242111363, 2026, 12, espn_s2="s2-secret", swid="{S}",
        ))
    assert token == 1821426335
    kwargs = mock_get.call_args.kwargs
    assert kwargs["cookies"] == {"espn_s2": "s2-secret", "SWID": "{S}"}
    assert "/teams/12/draftSecurity" in mock_get.call_args.args[0]


def test_non_lobby_league_sub_type_still_parses(client):
    """Only the mock-lobby marker is rejected — other sub types sync fine."""
    normal = json.loads(json.dumps(FIXTURE))
    normal["settings"] = {"draftSettings": {"leagueSubType": "NONE"}}

    with _patch_espn(payload=normal), _patch_players():
        resp = client.post("/api/draft/espn", json=REQUEST)

    assert resp.status_code == 200
    assert len(resp.json()["picks"]) == 4


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
