"""
U2b — NFL team bye weeks.

Bye weeks are a per-TEAM property (every player on a team shares one bye), so
rather than rely on per-player data (Sleeper leaves ``bye_week`` null in the
off-season), we fetch the pro-team schedule from ESPN's fantasy API and build a
``{team_abbrev: bye_week}`` map for the season. No API key is required and the
host (``fantasy.espn.com``) is the same one the projection scraper already uses.

Public API:
    load_team_byes(season: int, force_refresh=False) -> dict[str, int]

Returns an empty dict on any failure — callers degrade gracefully (the TM/BW
column simply shows the team with no bye, exactly as before this existed).
"""

from __future__ import annotations

import logging

import httpx

from app import cache

logger = logging.getLogger(__name__)

# proTeamSchedules_wl yields the lightweight settings.proTeams array, where each
# team carries its abbreviation and byeWeek for the requested season.
ESPN_SCHEDULE_URL = (
    "https://fantasy.espn.com/apis/v3/games/ffl/seasons/{season}"
    "?view=proTeamSchedules_wl"
)

# ESPN spells a handful of teams differently than the projection sources /
# Sleeper (which the rest of the pipeline keys on). Normalise to those codes so
# the bye map joins by the same team string the players carry.
_ESPN_TEAM_FIXUP = {
    "WSH": "WAS",
    "JAX": "JAC",
    "LAR": "LA",
}


def _cache_key(season: int) -> str:
    from datetime import date
    return f"team_byes_{season}_{date.today()}"


def _normalize_team(abbrev: str) -> str:
    abbrev = (abbrev or "").upper()
    return _ESPN_TEAM_FIXUP.get(abbrev, abbrev)


def load_team_byes(season: int, force_refresh: bool = False) -> dict[str, int]:
    """
    Fetch and cache the season's per-team bye weeks from ESPN.

    Returns
    -------
    dict mapping team abbreviation (str) → bye week (int). Empty on any failure;
    teams whose bye week is 0/missing (ESPN's placeholder before the schedule is
    final) are omitted.
    """
    ck = _cache_key(season)
    if not force_refresh:
        cached = cache.get(ck)
        if cached is not None:
            logger.info("Team byes loaded from cache (%d teams)", len(cached))
            return cached

    url = ESPN_SCHEDULE_URL.format(season=season)
    logger.info("Fetching ESPN pro-team schedule: %s", url)
    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("ESPN team-schedule fetch failed: %s", exc)
        return {}

    settings = data.get("settings", {}) if isinstance(data, dict) else {}
    pro_teams = settings.get("proTeams", []) if isinstance(settings, dict) else []

    result: dict[str, int] = {}
    for team in pro_teams:
        if not isinstance(team, dict):
            continue
        abbrev = _normalize_team(team.get("abbrev", ""))
        bye = team.get("byeWeek")
        if not abbrev or not bye:  # skip placeholders (byeWeek 0/None) and FA
            continue
        try:
            result[abbrev] = int(bye)
        except (TypeError, ValueError):
            continue

    if result:
        cache.set(ck, result)
        logger.info("Team byes cached: %d teams", len(result))
    else:
        logger.warning("ESPN team-schedule returned no usable bye weeks")
    return result
