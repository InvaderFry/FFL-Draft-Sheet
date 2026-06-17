"""
Sleeper live draft provider.

Fetches a league's draft state from Sleeper's public v1 API and normalizes it
into the provider-agnostic DraftStatus shape. Unlike ESPN, the Sleeper draft,
picks, and league-users endpoints need no authentication, so there are no
credentials to forward and no auth-failure path.

Sleeper is markedly simpler than ESPN in two ways the parser leans on:
  * A pick's ``player_id`` IS the Sleeper id, and the player map (data.players)
    is keyed by Sleeper id, so identity enrichment is a direct dict lookup — no
    crosswalk, no fuzzy matching.
  * Sleeper's REST ``/picks`` reflects every pick live, including mock drafts,
    so there is no websocket/userscript path like ESPN's mock lobby.

Each pick also carries its own metadata (first/last name, position, team), so a
pick is named even when the player map misses it (kickers, mid-season additions).
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

from app.data.players import get_player, load_player_map_async
from app.providers.base import DraftPick, DraftStatus, DraftTeam

logger = logging.getLogger(__name__)

SLEEPER_API = "https://api.sleeper.app/v1"


class SleeperError(Exception):
    """Base for Sleeper draft-fetch failures."""


class SleeperNotFoundError(SleeperError):
    pass


class SleeperSchemaError(SleeperError):
    pass


class SleeperTimeoutError(SleeperError):
    pass


class SleeperUpstreamError(SleeperError):
    pass


async def fetch_draft(draft_id: str) -> DraftStatus:
    logger.info("Fetching Sleeper draft: draft=%s", draft_id)

    try:
        async with httpx.AsyncClient(
            headers={"Accept": "application/json"}, timeout=10,
        ) as client:
            draft, picks_raw = await asyncio.gather(
                _get_json(client, f"/draft/{draft_id}"),
                _get_json(client, f"/draft/{draft_id}/picks"),
            )

            if draft is None:
                raise SleeperNotFoundError(f"Sleeper draft {draft_id} not found.")
            if not isinstance(draft, dict) or "status" not in draft:
                raise SleeperSchemaError(
                    "Sleeper returned an unexpected draft payload — check the "
                    "draft ID, or Sleeper's API may have changed."
                )

            # League users give real team names, but only league drafts have a
            # league_id — mock drafts don't, and a users failure must never sink
            # an otherwise-good draft, so it stays best-effort.
            users = await _fetch_users_best_effort(client, draft.get("league_id"))
    except SleeperError:
        raise
    except httpx.TimeoutException as exc:
        raise SleeperTimeoutError("Sleeper request timed out — try again.") from exc
    except httpx.RequestError as exc:
        raise SleeperUpstreamError("Could not reach Sleeper — try again.") from exc

    # Warm the player map before enrichment: once memoized, per-pick get_player
    # calls are dict hits rather than a ~11k-player fetch.
    await load_player_map_async()

    teams = _parse_teams(draft, users)
    picks = _parse_picks(picks_raw, draft)
    status = (draft.get("status") or "").lower()

    return DraftStatus(
        provider="sleeper",
        in_progress=status in ("drafting", "paused"),
        complete=status == "complete",
        picks=picks,
        teams=teams,
        fetched_at=time.time(),
    )


async def _get_json(client: httpx.AsyncClient, path: str):
    """GET a Sleeper endpoint; None on 404, raise on other upstream failures.

    Sleeper answers a missing/invalid id with 404 and a literal ``null`` body,
    so a None return is the natural "not found" signal for both.
    """
    resp = await client.get(f"{SLEEPER_API}{path}")
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise SleeperUpstreamError(f"Sleeper returned HTTP {resp.status_code}.")
    try:
        return resp.json()
    except ValueError as exc:
        raise SleeperSchemaError("Sleeper returned a non-JSON response.") from exc


async def _fetch_users_best_effort(
    client: httpx.AsyncClient, league_id: str | None,
) -> list[dict]:
    """League users for team names; [] when absent (mock draft) or on failure."""
    if not league_id:
        return []
    try:
        users = await _get_json(client, f"/league/{league_id}/users")
    except SleeperError as exc:
        logger.warning("Sleeper users lookup failed: %s", exc)
        return []
    return users if isinstance(users, list) else []


def _parse_teams(draft: dict, users: list[dict]) -> list[DraftTeam]:
    """Map every draft roster to a DraftTeam, keyed by roster_id (== pick.team_id).

    slot_to_roster_id enumerates the teams; draft_order (user_id → slot, null
    pre-draft) bridges roster → user so the users list can name it. Mock drafts
    lack draft_order/users entirely, so every team falls back to "Team N".
    """
    name_by_user: dict[str, str] = {}
    for u in users or []:
        uid = u.get("user_id")
        if not uid:
            continue
        meta = u.get("metadata") or {}
        name_by_user[str(uid)] = meta.get("team_name") or u.get("display_name") or ""

    draft_order = draft.get("draft_order") or {}  # user_id -> slot
    user_by_slot = {slot: str(uid) for uid, slot in draft_order.items()}
    slot_to_roster = draft.get("slot_to_roster_id") or {}  # slot(str) -> roster_id

    teams = []
    for slot_str, roster_id in slot_to_roster.items():
        if roster_id is None:
            continue
        try:
            slot = int(slot_str)
        except (TypeError, ValueError):
            continue
        uid = user_by_slot.get(slot)
        name = name_by_user.get(uid) if uid else None
        teams.append(DraftTeam(
            team_id=str(roster_id),
            name=name or f"Team {roster_id}",
            abbrev=None,
        ))
    teams.sort(key=lambda t: int(t.team_id) if t.team_id.isdigit() else 0)
    return teams


def _parse_picks(picks_raw, draft: dict) -> list[DraftPick]:
    if not isinstance(picks_raw, list):
        return []
    n_teams = ((draft.get("settings") or {}).get("teams")) or 0

    picks = []
    for p in picks_raw:
        if not isinstance(p, dict) or p.get("player_id") is None:
            continue
        overall = int(p.get("pick_no") or 0)
        round_pick = None
        if n_teams:
            round_pick = ((overall - 1) % n_teams) + 1
        pick = DraftPick(
            overall=overall,
            round=p.get("round"),
            round_pick=round_pick,
            team_id=str(p.get("roster_id", "")),
            provider_player_id=str(p.get("player_id")),
        )
        _enrich_pick(pick, p)
        picks.append(pick)
    picks.sort(key=lambda pk: pk.overall)
    return picks


def _enrich_pick(pick: DraftPick, raw: dict) -> None:
    """Fill name/pos/ids from the Sleeper player map; degrade to pick metadata.

    player_id == sleeper_id, so the map is a direct hit for ordinary players and
    for team defenses (Sleeper keys those by team abbrev, e.g. "DEN", normalised
    to DST in the map). Anything the map misses — kickers, brand-new players — is
    named from the pick's own metadata, with sleeper_id left None.
    """
    rec = get_player(pick.provider_player_id)
    if rec is not None:
        pick.sleeper_id = rec.sleeper_id
        pick.player_name = rec.full_name
        pick.pos = rec.position
        pick.nfl_team = rec.team
        return

    meta = raw.get("metadata") or {}
    pos = (meta.get("position") or "").upper()
    if pos == "DEF":
        pos = "DST"
    if pos == "DST":
        team = meta.get("team") or pick.provider_player_id
        pick.pos = "DST"
        pick.nfl_team = team
        pick.player_name = f"{team} DST"
        return

    name = f"{meta.get('first_name', '')} {meta.get('last_name', '')}".strip()
    pick.player_name = name or None
    pick.pos = pos or None
    pick.nfl_team = meta.get("team") or None
