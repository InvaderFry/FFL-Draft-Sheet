"""
U11 — ADP loader.

Fetches ADP from Fantasy Football Calculator's free REST API and joins it
onto player rows via the Sleeper→ESPN ID crosswalk.

FFC endpoint:
  https://fantasyfootballcalculator.com/api/v1/adp/{format}?teams={n}&count=300

Returns a dict mapping espn_id → {adp_rank, adp_pick (alias), ecr_fmt, ecr_color}.
ECR coloring is intentionally left to the frontend (R-decision in the plan),
but ecr_rank and adp_rank integers are also returned so the React component can apply it.
"""

from __future__ import annotations

import logging

import httpx

from app import cache

logger = logging.getLogger(__name__)

FFC_BASE = "https://fantasyfootballcalculator.com/api/v1/adp"

# FFC format string based on PPR value
def _ffc_format(ppr: float) -> str:
    if ppr >= 1.0:
        return "ppr"
    if ppr >= 0.5:
        return "half-ppr"
    return "standard"


def _cache_key(n_teams: int, ppr: float) -> str:
    from datetime import date
    return f"ffc_adp_{n_teams}_{_ffc_format(ppr)}_{date.today()}"


def fetch_adp(n_teams: int, ppr: float = 0.5, force_refresh: bool = False) -> dict[str, dict]:
    """
    Fetch and cache ADP.

    Returns
    -------
    dict mapping espn_id (str) → {
        "adp_rank":   int,
        "player_name": str,
        "pos":         str,
        "team":        str,
    }
    Returns empty dict on failure (ADP is optional; board degrades gracefully).
    """
    ck = _cache_key(n_teams, ppr)
    if not force_refresh:
        cached = cache.get(ck)
        if cached is not None:
            logger.info("ADP loaded from cache (%d players)", len(cached))
            return cached

    fmt = _ffc_format(ppr)
    url = f"{FFC_BASE}/{fmt}"
    params = {"teams": n_teams, "count": 400}

    logger.info("Fetching FFC ADP: %s (teams=%d)", url, n_teams)
    try:
        resp = httpx.get(url, params=params, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("FFC ADP fetch failed: %s", exc)
        return {}

    players = data.get("players", [])
    result: dict[str, dict] = {}
    for rank, p in enumerate(players, start=1):
        eid = str(p.get("espn_id") or p.get("id") or "")
        if not eid or eid == "0":
            continue
        result[eid] = {
            "adp_rank":    rank,
            "player_name": p.get("name", ""),
            "pos":         (p.get("position") or "").upper(),
            "team":        p.get("team", ""),
        }

    cache.set(ck, result)
    logger.info("ADP cached: %d players", len(result))
    return result


def enrich_with_adp(
    player_rows: list[dict],
    n_teams: int,
    ppr: float = 0.5,
) -> tuple[list[dict], bool]:
    """
    Join ADP data onto player rows using espn_id.
    Adds 'adp_rank' and 'ecr_rank' to each row.
    Also computes 'ecr_fmt' (round|pick string) on the backend as a convenience.

    Returns (enriched_rows, adp_available).
    """
    adp_map = fetch_adp(n_teams, ppr)
    adp_available = bool(adp_map)

    for row in player_rows:
        eid = row.get("espn_id") or ""
        adp_info = adp_map.get(str(eid))
        if adp_info:
            rank = adp_info["adp_rank"]
            row["adp_rank"] = rank
            row["ecr_rank"] = rank  # FFC ADP used as ECR proxy
            row["ecr_fmt"] = _fmt_ecr(rank, n_teams)
        else:
            row["adp_rank"] = None
            row["ecr_rank"] = None
            row["ecr_fmt"] = "—"

    return player_rows, adp_available


def _fmt_ecr(rank: int, n_teams: int) -> str:
    """Format an ECR rank as 'round|pick', e.g. '3|07' for pick 31 in a 12-team league."""
    rd = (rank - 1) // n_teams + 1
    pk = (rank - 1) % n_teams + 1
    return f"{rd}|{pk:02d}"
