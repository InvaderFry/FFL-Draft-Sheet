"""
ESPN draft-room WebSocket sessions (Mock Draft Lobby live sync).

ESPN never writes mock-lobby picks back to its REST API, so the only live
source is the draft room's socket at wss://fantasydraft.espn.com. The
protocol (decoded from a browser capture, see docs/espn-draft-api.md) is
line-based text:

    TOKEN 1:<leagueId>:<teamId>:<SWID>:<token>      join ack
    STATE 1                                         draft started
    SELECTING <teamId> <msBudget>                   team on the clock
    SELECTED <teamId> <playerId> <slotId> [{SWID}]  pick made (no SWID = auto)
    CLOCK / JOINED / LEFT / AUTODRAFT / AUTOSUGGEST room noise (ignored)

Overall pick number is the SELECTED event sequence (snake order is the
server's concern). The INIT frame is an undecoded binary blob, so picks made
before the session connects are not recoverable — connect before the draft
starts. The client must send "PING PING%20<ms>" keepalives (~15s).

One session per (league, season), owned by the asyncio loop the API runs on.
The polling endpoint reads snapshots via status(); sessions are evicted when
nobody has polled for a while. This module never SENDs draft actions
(SELECT) — it is a read-only room member.

SECURITY: sessions hold espn_s2/SWID to (re)join. Same rules as espn.py —
never log, cache, or echo them.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time

import websockets

from app.data.espn_players import load_espn_directory_async
from app.data.players import load_player_map_async
from app.providers.base import DraftPick, DraftStatus
from app.providers.espn import (
    EspnUpstreamError,
    MockLobbyDraft,
    _enrich_pick,
    fetch_draft_security,
)

logger = logging.getLogger(__name__)

DEFAULT_WS_BASE = "wss://fantasydraft.espn.com"
PING_INTERVAL_S = 15
MAX_REJOIN_ATTEMPTS = 3
# Sessions nobody polls are abandoned drafts (tab closed / disconnected).
IDLE_EVICT_S = 120
# Browser-like headers: the join URL carries all auth, but stay close to the
# observed handshake so we aren't filtered as a bot.
ORIGIN = "https://fantasy.espn.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
)


def parse_frame(line: str) -> tuple | None:
    """Decode one socket line into an event tuple, or None for room noise.

    Events: ("selected", team_id, player_id), ("selecting", team_id),
    ("state", n). Malformed lines are treated as noise — the protocol is
    undocumented, so never let a surprise frame kill the session.
    """
    parts = line.strip().split()
    if not parts:
        return None
    verb = parts[0]
    try:
        if verb == "SELECTED" and len(parts) >= 3:
            return ("selected", int(parts[1]), int(parts[2]))
        if verb == "SELECTING" and len(parts) >= 2:
            return ("selecting", int(parts[1]))
        if verb == "STATE" and len(parts) >= 2:
            return ("state", int(parts[1]))
    except ValueError:
        logger.debug("Unparseable draft-room frame: %.80s", line)
        return None
    return None


def _join_url(lobby: MockLobbyDraft, token: int) -> str:
    base = os.environ.get("ESPN_WS_BASE", DEFAULT_WS_BASE)
    credential = (
        f"1:{lobby.league_id}:{lobby.team_id}:{lobby.swid}:{token}"
    )
    return (
        f"{base}/game-1/league-{lobby.league_id}/JOIN"
        f"?1=1&2={lobby.league_id}&3={lobby.team_id}&4={lobby.swid}"
        f"&5={credential}&6=false&7=false&8=KONA"
        f"&nocache={random.randint(1, 999999)}"
    )


class DraftRoomSession:
    """One live draft-room connection, accumulating picks for poll reads."""

    def __init__(self, lobby: MockLobbyDraft):
        self._lobby = lobby
        self.picks: list[DraftPick] = []
        self.in_progress = False
        self.complete = False
        self.last_polled = time.time()
        self._task = asyncio.create_task(self._run())

    def status(self) -> DraftStatus:
        self.last_polled = time.time()
        return DraftStatus(
            provider="espn",
            in_progress=self.in_progress and not self.complete,
            complete=self.complete,
            picks=list(self.picks),
            teams=self._lobby.teams,
            fetched_at=time.time(),
        )

    def close(self) -> None:
        self._task.cancel()

    async def _run(self) -> None:
        lobby = self._lobby
        # Warm the Sleeper bridge once so per-pick enrichment is a dict hit.
        try:
            await load_player_map_async()
        except Exception as exc:
            logger.warning("Player map warmup failed: %s", exc)

        attempts = 0
        while not self.complete and attempts <= MAX_REJOIN_ATTEMPTS:
            try:
                token = await fetch_draft_security(
                    lobby.league_id, lobby.season, lobby.team_id,
                    espn_s2=lobby.espn_s2, swid=lobby.swid,
                )
                async with websockets.connect(
                    _join_url(lobby, token),
                    origin=ORIGIN,
                    user_agent_header=USER_AGENT,
                    # ESPN's keepalive is the application-level PING below;
                    # leave protocol pings on as a safety net.
                ) as ws:
                    logger.info(
                        "Joined ESPN draft room: league=%s team=%s",
                        lobby.league_id, lobby.team_id,
                    )
                    attempts = 0
                    await self._listen(ws)
                # Server closed cleanly. Mid-draft that means the room ended
                # (mock rooms shut down right after the last pick).
                if self.in_progress and self.picks:
                    self.complete = True
                    logger.info(
                        "Draft room closed after %d picks; marking complete "
                        "(league=%s)", len(self.picks), lobby.league_id,
                    )
                    return
                attempts += 1
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                attempts += 1
                logger.warning(
                    "Draft room connection lost (league=%s, attempt %d/%d): %s",
                    lobby.league_id, attempts, MAX_REJOIN_ATTEMPTS, exc,
                )
            if not self.complete and attempts <= MAX_REJOIN_ATTEMPTS:
                # Picks made while disconnected are lost (INIT is undecoded);
                # rejoin quickly to keep the gap small.
                await asyncio.sleep(min(2 ** attempts, 10))

    async def _listen(self, ws) -> None:
        ping = asyncio.create_task(self._keepalive(ws))
        try:
            async for message in ws:
                if isinstance(message, bytes):
                    continue  # INIT-style binary frames: undecoded room state
                for line in message.splitlines():
                    await self._handle(parse_frame(line))
        finally:
            ping.cancel()

    async def _keepalive(self, ws) -> None:
        # Observed client behavior: "PING PING%20<ms-timestamp>" every ~15s,
        # echoed back as PONG. Without it the server drops idle members.
        try:
            while True:
                await asyncio.sleep(PING_INTERVAL_S)
                await ws.send(f"PING PING%20{int(time.time() * 1000)}")
        except websockets.exceptions.ConnectionClosed:
            return  # the listen loop handles the closure

    async def _handle(self, event: tuple | None) -> None:
        if event is None:
            return
        kind = event[0]
        if kind in ("state", "selecting"):
            self.in_progress = True
            return
        _, team_id, player_id = event
        pick = DraftPick(
            overall=len(self.picks) + 1,
            team_id=str(team_id),
            provider_player_id=str(player_id),
        )
        _enrich_pick(pick, player_id)
        if pick.player_name is None:
            try:
                directory = await load_espn_directory_async(self._lobby.season)
                entry = directory.get(str(player_id))
                if entry:
                    pick.player_name = entry.get("name")
                    pick.pos = pick.pos or entry.get("pos")
                    pick.nfl_team = pick.nfl_team or entry.get("team")
            except Exception as exc:
                logger.warning("ESPN directory lookup failed: %s", exc)
        self.in_progress = True
        self.picks.append(pick)


_sessions: dict[tuple[int, int], DraftRoomSession] = {}


def get_or_create(lobby: MockLobbyDraft) -> DraftRoomSession:
    """Session for this mock league, starting one (and evicting idle ones).

    Raises EspnUpstreamError when an existing session's connection gave up,
    so the failure surfaces to the user instead of an eternal empty
    "waiting for picks" — the session is dropped, and the frontend's retry
    (or its next backoff poll) starts a fresh one.
    """
    now = time.time()
    for key, session in list(_sessions.items()):
        if now - session.last_polled > IDLE_EVICT_S:
            session.close()
            del _sessions[key]
            logger.info("Evicted idle draft-room session: league=%s", key[0])

    key = (lobby.league_id, lobby.season)
    session = _sessions.get(key)
    if session is not None and session._task.done() and not session.complete:
        session.close()
        del _sessions[key]
        raise EspnUpstreamError(
            "Lost the connection to the ESPN draft room — retrying. Picks "
            "made while disconnected may be missing."
        )
    if session is None:
        session = DraftRoomSession(lobby)
        _sessions[key] = session
    return session
