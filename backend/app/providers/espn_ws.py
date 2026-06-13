"""
ESPN draft-room socket ingest store (Mock Draft Lobby live sync).

ESPN allows one active draft socket per (member, team), so the backend must not
join the room with the user's credentials. Instead, a browser userscript taps
the draft tab's existing socket and POSTs the line-based draft-room frames to
the backend. This module parses those frames, accumulates picks in memory, and
serves DraftStatus snapshots to the existing polling endpoint.

The protocol (decoded from a browser capture, see docs/espn-draft-api.md) is
line-based text:

    TOKEN 1:<leagueId>:<teamId>:<SWID>:<token>      join ack
    STATE 1                                         draft started
    SELECTING <teamId> <msBudget>                   team on the clock
    SELECTED <teamId> <playerId> <slotId> [{SWID}]  pick made (no SWID = auto)
    CLOCK / JOINED / LEFT / AUTODRAFT / AUTOSUGGEST room noise (ignored)

Overall pick number is the SELECTED event sequence. Picks made before the
userscript wraps WebSocket are not recoverable from the tapped text lines, so
install and open the ESPN draft page before the room starts.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from app.data.espn_players import load_espn_directory
from app.providers.base import DraftPick, DraftStatus, DraftTeam
from app.providers.espn import _enrich_pick

logger = logging.getLogger(__name__)

# Sessions nobody polls are abandoned drafts (tab closed / disconnected).
IDLE_EVICT_S = 120


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


@dataclass
class IngestSession:
    """Accumulated browser-tapped draft-room lines for one mock draft."""

    league_id: int
    season: int
    teams: list[DraftTeam] = field(default_factory=list)
    picks: list[DraftPick] = field(default_factory=list)
    seen_player_ids: set[int] = field(default_factory=set)
    in_progress: bool = False
    complete: bool = False
    last_updated: float = field(default_factory=time.time)
    last_polled: float = field(default_factory=time.time)

    def ingest(self, lines: list[str], complete: bool = False) -> int:
        for raw in lines:
            for line in raw.splitlines():
                self._handle(parse_frame(line))
        if complete:
            self.complete = True
            self.in_progress = False
        self.last_updated = time.time()
        return len(self.picks)

    def status(self, teams: list[DraftTeam] | None = None) -> DraftStatus:
        if teams is not None:
            self.teams = teams
        self.last_polled = time.time()
        return DraftStatus(
            provider="espn",
            in_progress=self.in_progress and not self.complete,
            complete=self.complete,
            picks=list(self.picks),
            teams=list(self.teams),
            fetched_at=time.time(),
        )

    def _handle(self, event: tuple | None) -> None:
        if event is None:
            return
        kind = event[0]
        if kind in ("state", "selecting"):
            if not self.complete:
                self.in_progress = True
            return

        _, team_id, player_id = event
        if player_id in self.seen_player_ids:
            return
        pick = DraftPick(
            overall=len(self.picks) + 1,
            team_id=str(team_id),
            provider_player_id=str(player_id),
        )
        _enrich_pick(pick, player_id)
        if pick.player_name is None:
            try:
                directory = load_espn_directory(self.season)
                entry = directory.get(str(player_id))
                if entry:
                    pick.player_name = entry.get("name")
                    pick.pos = pick.pos or entry.get("pos")
                    pick.nfl_team = pick.nfl_team or entry.get("team")
            except Exception as exc:
                logger.warning("ESPN directory lookup failed: %s", exc)
        self.seen_player_ids.add(player_id)
        self.in_progress = True
        self.picks.append(pick)


_sessions: dict[tuple[int, int], IngestSession] = {}


def _evict_idle(now: float | None = None) -> None:
    now = now or time.time()
    for key, session in list(_sessions.items()):
        if now - session.last_polled > IDLE_EVICT_S:
            del _sessions[key]
            logger.info("Evicted idle draft ingest session: league=%s", key[0])


def _get_session(league_id: int, season: int) -> IngestSession:
    _evict_idle()
    key = (league_id, season)
    session = _sessions.get(key)
    if session is None:
        session = IngestSession(league_id=league_id, season=season)
        _sessions[key] = session
    return session


def ingest(
    league_id: int,
    season: int,
    lines: list[str],
    complete: bool = False,
) -> int:
    """Ingest tapped draft-room lines and return the accumulated pick count."""
    session = _get_session(league_id, season)
    return session.ingest(lines, complete=complete)


def snapshot(
    league_id: int,
    season: int,
    teams: list[DraftTeam] | None = None,
) -> DraftStatus:
    """Return a pollable DraftStatus for the tapped mock-draft session."""
    session = _get_session(league_id, season)
    return session.status(teams=teams)
