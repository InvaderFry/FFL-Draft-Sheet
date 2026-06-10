"""
ESPN live draft provider.

Fetches a league's draft state from ESPN's undocumented v3 fantasy API
(view=mDraftDetail for picks, view=mTeams for team names) and normalizes it
into the provider-agnostic DraftStatus shape. Public leagues need only the
league id; private leagues additionally need the espn_s2 + SWID cookies.

SECURITY: espn_s2/SWID are full ESPN account credentials. They are forwarded
to ESPN as request cookies and MUST never be logged, cached, or echoed in
error messages — log only league_id/season/has_cookies.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

from app.data.players import get_player_by_espn_id, load_player_map
from app.providers.base import DraftPick, DraftStatus, DraftTeam

logger = logging.getLogger(__name__)

ESPN_LEAGUE_URL = (
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
    "/seasons/{season}/segments/0/leagues/{league_id}"
)

# ESPN encodes a D/ST pick as playerId = -16000 - proTeamId.
ESPN_PRO_TEAMS = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
    15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
    21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA",
    27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}


class EspnError(Exception):
    """Base for ESPN draft-fetch failures."""


class EspnAuthError(EspnError):
    pass


class EspnNotFoundError(EspnError):
    pass


class EspnSchemaError(EspnError):
    pass


class EspnTimeoutError(EspnError):
    pass


class EspnUpstreamError(EspnError):
    pass


async def fetch_draft(
    league_id: int,
    season: int,
    espn_s2: str | None = None,
    swid: str | None = None,
) -> DraftStatus:
    url = ESPN_LEAGUE_URL.format(season=season, league_id=league_id)
    params = [("view", "mDraftDetail"), ("view", "mTeams")]
    cookies: dict[str, str] = {}
    if espn_s2:
        cookies["espn_s2"] = espn_s2
    if swid:
        cookies["SWID"] = swid

    logger.info(
        "Fetching ESPN draft: league=%s season=%s has_cookies=%s",
        league_id, season, bool(cookies),
    )

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(
                url,
                params=params,
                cookies=cookies or None,
                headers={"Accept": "application/json"},
                timeout=10,
            )
    except httpx.TimeoutException as exc:
        raise EspnTimeoutError("ESPN request timed out — try again.") from exc
    except httpx.RequestError as exc:
        raise EspnUpstreamError("Could not reach ESPN — try again.") from exc

    if resp.status_code in (401, 403):
        raise EspnAuthError(
            "ESPN denied access to this league. If it is private, provide "
            "espn_s2 and SWID cookies (and check they are current)."
        )
    if resp.status_code == 404:
        raise EspnNotFoundError(
            f"ESPN league {league_id} not found for season {season}."
        )
    if resp.status_code != 200:
        raise EspnUpstreamError(f"ESPN returned HTTP {resp.status_code}.")

    try:
        data = resp.json()
    except ValueError as exc:
        raise EspnSchemaError("ESPN returned a non-JSON response.") from exc

    # The leagueHistory variant of this endpoint wraps the league in a list.
    if isinstance(data, list):
        data = data[0] if data else {}
    if not isinstance(data, dict) or "draftDetail" not in data:
        raise EspnSchemaError(
            "ESPN response did not contain draft data — the league may be "
            "private (provide cookies) or ESPN's API may have changed."
        )

    # Warm the player map off the event loop: on a cold cache load_player_map
    # does a synchronous ~11k-player Sleeper fetch (up to 30s) that would
    # otherwise block every concurrent request. Once memoized, per-pick
    # lookups in _parse_league are dict hits.
    await asyncio.to_thread(load_player_map)

    return _parse_league(data)


def _parse_league(data: dict) -> DraftStatus:
    detail = data.get("draftDetail") or {}

    teams = []
    for t in data.get("teams") or []:
        tid = t.get("id")
        if tid is None:
            continue
        name = (t.get("name") or "").strip()
        if not name:
            name = f"{t.get('location', '')} {t.get('nickname', '')}".strip()
        teams.append(DraftTeam(
            team_id=str(tid),
            name=name or f"Team {tid}",
            abbrev=t.get("abbrev"),
        ))

    picks = []
    for i, p in enumerate(detail.get("picks") or []):
        player_id = p.get("playerId")
        if player_id is None:
            continue
        pick = DraftPick(
            overall=int(p.get("overallPickNo") or i + 1),
            round=p.get("roundId"),
            round_pick=p.get("roundPickNumber"),
            team_id=str(p.get("teamId", "")),
            provider_player_id=str(player_id),
        )
        _enrich_pick(pick, int(player_id))
        picks.append(pick)
    picks.sort(key=lambda pk: pk.overall)

    return DraftStatus(
        provider="espn",
        in_progress=bool(detail.get("inProgress")),
        complete=bool(detail.get("drafted")),
        picks=picks,
        teams=teams,
        fetched_at=time.time(),
    )


def _enrich_pick(pick: DraftPick, player_id: int) -> None:
    """Fill name/pos/ids from the Sleeper player map; degrade gracefully."""
    if player_id < 0:
        # D/ST — Sleeper rarely bridges these ids, so decode directly.
        abbrev = ESPN_PRO_TEAMS.get(-player_id - 16000)
        pick.pos = "DST"
        pick.nfl_team = abbrev
        pick.player_name = f"{abbrev} DST" if abbrev else None
        return

    rec = get_player_by_espn_id(str(player_id))
    if rec is not None:
        pick.sleeper_id = rec.sleeper_id
        pick.player_name = rec.full_name
        pick.pos = rec.position
        pick.nfl_team = rec.team
