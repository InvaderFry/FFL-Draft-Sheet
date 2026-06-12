"""
ESPN player directory.

ESPN's draft API (view=mDraftDetail) identifies players only by numeric
playerId; names normally come from bridging that id through the Sleeper
player map. This module is the fallback for picks the bridge misses
(kickers, Sleeper records without an espn_id, a failed Sleeper load): a
per-season id → {name, pos, team} directory fetched from ESPN's own
league-independent players endpoint.

The endpoint needs no league id and no credentials — never pass cookies or
anything credential-shaped into this module.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time

import httpx

from app import cache

logger = logging.getLogger(__name__)

ESPN_PLAYERS_URL = (
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
    "/seasons/{season}/players"
)

# ESPN proTeamId → abbreviation (also used to decode D/ST picks, which ESPN
# encodes as playerId = -16000 - proTeamId).
ESPN_PRO_TEAMS = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
    15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
    21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA",
    27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}

ESPN_POSITION_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST"}

CACHE_KEY_FMT = "espn_players_{season}"
# After a failed fetch, don't retry within this window — the draft-sync poll
# loop runs every few seconds and must not hammer ESPN. Transient failures
# self-heal on the first poll after the cooldown.
RETRY_COOLDOWN = 300

_directories: dict[int, dict[str, dict]] = {}
_failed_at: dict[int, float] = {}
_load_lock = threading.Lock()


def _parse_players(raw: object) -> dict[str, dict]:
    """players_wl response → {espn_id: {name, pos, team}}; skip junk entries."""
    if not isinstance(raw, list):
        raise ValueError("unexpected ESPN players payload shape")
    directory: dict[str, dict] = {}
    for p in raw:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        name = p.get("fullName")
        if pid is None or not name:
            continue
        directory[str(pid)] = {
            "name": name,
            "pos": ESPN_POSITION_MAP.get(p.get("defaultPositionId")),
            "team": ESPN_PRO_TEAMS.get(p.get("proTeamId")),
        }
    return directory


def load_espn_directory(season: int, force_refresh: bool = False) -> dict[str, dict]:
    """
    Return ESPN's player directory for a season, keyed by str(playerId).
    Memoized per season + file-cached; a failed fetch returns {} and is
    retried only after RETRY_COOLDOWN.
    """
    if not force_refresh and season in _directories:
        return _directories[season]

    with _load_lock:
        if not force_refresh and season in _directories:
            return _directories[season]

        if not force_refresh:
            cached = cache.get(CACHE_KEY_FMT.format(season=season))
            if cached is not None:
                logger.info(
                    "ESPN player directory loaded from file cache (%d players, season %s)",
                    len(cached), season,
                )
                _failed_at.pop(season, None)
                _directories[season] = cached
                return cached
            failed = _failed_at.get(season)
            if failed is not None and time.time() - failed < RETRY_COOLDOWN:
                return {}

        logger.info("Fetching ESPN player directory for season %s…", season)
        try:
            resp = httpx.get(
                ESPN_PLAYERS_URL.format(season=season),
                params={"view": "players_wl"},
                headers={
                    "Accept": "application/json",
                    "x-fantasy-filter": json.dumps(
                        {"filterActive": {"value": True}}
                    ),
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            directory = _parse_players(resp.json())
        except Exception as exc:
            logger.warning(
                "ESPN player directory fetch failed for season %s: %s", season, exc
            )
            _failed_at[season] = time.time()
            return {}

        cache.set(CACHE_KEY_FMT.format(season=season), directory)
        logger.info(
            "ESPN player directory: %d players cached (season %s)",
            len(directory), season,
        )
        _failed_at.pop(season, None)
        _directories[season] = directory
        return directory


async def load_espn_directory_async(
    season: int, force_refresh: bool = False
) -> dict[str, dict]:
    """Async-safe entry point — the sync load blocks on network + file I/O."""
    return await asyncio.to_thread(load_espn_directory, season, force_refresh)
