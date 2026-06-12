"""Tests for the ESPN draft-room WebSocket session layer (espn_ws)."""

import asyncio
import contextlib
from unittest.mock import AsyncMock, patch

import pytest
import websockets

from app.providers import espn_ws
from app.providers.espn import MockLobbyDraft
from app.providers.base import DraftTeam

SWID = "{E31D96BE-58CE-45C4-9D96-BE58CEB5C4E3}"


# ---- parse_frame: lines below are verbatim from the captured HAR ---------------

@pytest.mark.parametrize("line,expected", [
    ("SELECTED 9 3929630 2 {607A4111-1E4D-45C6-A545-7842DD4BAB10}\n",
     ("selected", 9, 3929630)),
    ("SELECTED 2 4426515 4\n", ("selected", 2, 4426515)),  # autopick: no SWID
    ("SELECTING 12 30000\n", ("selecting", 12)),
    ("STATE 1\n", ("state", 1)),
    ("CLOCK 6 29500 2\n", None),
    ("CLOCK 0 82574\n", None),
    ("AUTOSUGGEST 4429795\n", None),
    ("JOINED 12 " + SWID + "\n", None),
    ("LEFT 6 {69C876B8-2558-4F66-8876-B82558AF664E} 0\n", None),
    ("AUTODRAFT 12 false\n", None),
    ("PONG PING%201781294100752\n", None),
    ("TOKEN 1:1242111363:12:" + SWID + ":1821426335\n", None),
    ("DRAFT_LIST 4429160 4241389\n", None),
    ("", None),
    ("SELECTED garbage not-an-int\n", None),  # malformed → noise, not a crash
])
def test_parse_frame(line, expected):
    assert espn_ws.parse_frame(line) == expected


# ---- DraftRoomSession against a local fake draft-room server -------------------

def _lobby(league_id=1242111363):
    return MockLobbyDraft(
        league_id=league_id, season=2026, team_id=12,
        espn_s2="s2-secret", swid=SWID,
        teams=[DraftTeam(team_id="12", name="z's Honorable Team")],
    )


@contextlib.asynccontextmanager
async def _fake_room(handler, monkeypatch):
    """Local ws server standing in for fantasydraft.espn.com."""
    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        monkeypatch.setenv("ESPN_WS_BASE", f"ws://127.0.0.1:{port}")
        yield server


@contextlib.contextmanager
def _patch_session_deps():
    """Stub the network/data dependencies the session reaches for."""
    with patch(
        "app.providers.espn_ws.fetch_draft_security",
        new_callable=AsyncMock, return_value=1821426335,
    ) as security_mock, patch(
        "app.providers.espn_ws.load_player_map_async",
        new_callable=AsyncMock, return_value={},
    ), patch(
        "app.providers.espn_ws.load_espn_directory_async",
        new_callable=AsyncMock,
        return_value={"3929630": {"name": "Christian McCaffrey",
                                  "pos": "RB", "team": "SF"}},
    ), patch(
        "app.providers.espn.get_player_by_espn_id", return_value=None,
    ):
        yield security_mock


async def _wait_for(predicate, timeout=5.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while not predicate():
        if asyncio.get_event_loop().time() > deadline:
            raise AssertionError("condition not met before timeout")
        await asyncio.sleep(0.02)


@pytest.mark.asyncio
async def test_session_accumulates_picks_and_completes(monkeypatch):
    """The captured frame sequence becomes ordered, enriched picks; a clean
    server close mid-draft marks the session complete."""
    async def room(ws):
        assert "/game-1/league-1242111363/JOIN" in ws.request.path
        assert "5=1:1242111363:12:" + SWID + ":1821426335" in ws.request.path
        await ws.send("AUTODRAFT 12 false\n")
        await ws.send("TOKEN 1:1242111363:12:" + SWID + ":1821426335\n")
        await ws.send("CLOCK 0 82574\n")
        await ws.send("STATE 1\n")
        await ws.send("SELECTING 1 30000\n")
        await ws.send("SELECTED 1 4429795 2 {7FD0427D-E8DA-4287-B897-833842B6429A}\n")
        await ws.send("SELECTING 2 30000\n")
        await ws.send("SELECTED 2 4426515 4\n")  # autopick
        await ws.send("SELECTED 9 3929630 2 {607A4111-1E4D-45C6-A545-7842DD4BAB10}\n")
        await asyncio.sleep(0.2)  # let the client drain before closing

    with _patch_session_deps():
        async with _fake_room(room, monkeypatch):
            session = espn_ws.DraftRoomSession(_lobby())
            try:
                await _wait_for(lambda: session.complete)

                status = session.status()
                assert [p.overall for p in status.picks] == [1, 2, 3]
                assert [p.team_id for p in status.picks] == ["1", "2", "9"]
                assert status.picks[0].provider_player_id == "4429795"
                # Sleeper bridge missed everyone; the directory named CMC.
                assert status.picks[2].player_name == "Christian McCaffrey"
                assert status.picks[2].pos == "RB"
                assert status.picks[0].player_name is None
                assert status.complete is True
                assert status.in_progress is False
                assert status.teams[0].name == "z's Honorable Team"
            finally:
                session.close()


@pytest.mark.asyncio
async def test_session_sends_keepalive_pings(monkeypatch):
    received = []

    async def room(ws):
        await ws.send("STATE 1\n")
        async for message in ws:
            received.append(message)

    monkeypatch.setattr(espn_ws, "PING_INTERVAL_S", 0.05)
    with _patch_session_deps():
        async with _fake_room(room, monkeypatch):
            session = espn_ws.DraftRoomSession(_lobby())
            try:
                await _wait_for(lambda: len(received) >= 2)
            finally:
                session.close()
    assert all(m.startswith("PING PING%20") for m in received)


@pytest.mark.asyncio
async def test_session_rejoins_after_abnormal_disconnect(monkeypatch):
    connections = []

    async def room(ws):
        connections.append(ws)
        if len(connections) == 1:
            # Simulate the room falling over mid-draft.
            await ws.send("STATE 1\n")
            await ws.close(code=1011)
            return
        await ws.send("SELECTED 1 4429795 2\n")
        await asyncio.sleep(0.5)

    with _patch_session_deps() as security_mock:
        async with _fake_room(room, monkeypatch):
            session = espn_ws.DraftRoomSession(_lobby())
            try:
                await _wait_for(lambda: len(session.picks) == 1)
                # The rejoin fetched a fresh draft-security token.
                assert security_mock.await_count == 2
            finally:
                session.close()


@pytest.mark.asyncio
async def test_dead_session_surfaces_error_and_is_dropped(monkeypatch):
    """A session whose connection gave up must not stall polls silently —
    the next poll gets an upstream error and a fresh start after that."""
    monkeypatch.setattr(espn_ws, "MAX_REJOIN_ATTEMPTS", 0)
    with patch(
        "app.providers.espn_ws.fetch_draft_security",
        new_callable=AsyncMock, side_effect=Exception("room is gone"),
    ), patch(
        "app.providers.espn_ws.load_player_map_async",
        new_callable=AsyncMock, return_value={},
    ):
        espn_ws._sessions.clear()
        session = espn_ws.get_or_create(_lobby())
        await _wait_for(lambda: session._task.done())

        with pytest.raises(espn_ws.EspnUpstreamError):
            espn_ws.get_or_create(_lobby())
        assert espn_ws._sessions == {}


@pytest.mark.asyncio
async def test_registry_reuses_and_evicts_sessions(monkeypatch):
    async def room(ws):
        await ws.send("STATE 1\n")
        await asyncio.sleep(1)

    with _patch_session_deps():
        async with _fake_room(room, monkeypatch):
            espn_ws._sessions.clear()
            first = espn_ws.get_or_create(_lobby())
            try:
                assert espn_ws.get_or_create(_lobby()) is first

                # A session nobody polls gets evicted and replaced.
                first.last_polled -= espn_ws.IDLE_EVICT_S + 1
                second = espn_ws.get_or_create(_lobby())
                assert second is not first
                second.close()
            finally:
                first.close()
                espn_ws._sessions.clear()
