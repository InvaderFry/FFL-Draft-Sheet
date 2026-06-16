"""
U11 — ADP/ECR enrichment.

Fetches ADP from Fantasy Football Calculator's free REST API (joined onto player
rows via the Sleeper→ESPN ID crosswalk) and combines it with real Expert
Consensus Rankings from FantasyPros (data/ecr.py). ADP and ECR are kept as
independent sources so the frontend's ADP-vs-ECR divergence coloring is
meaningful (frontend/src/utils/ecrColor.js).

FFC endpoint:
  https://fantasyfootballcalculator.com/api/v1/adp/{format}?teams={n}&count=400&year={season}

Early in the off-season FFC has no current-season ADP yet, so fetch_adp falls
back to the prior season. When FantasyPros ECR is unavailable (no API key /
upstream down), ECR falls back to the FFC ADP rank as a proxy — the behavior
before real ECR existed. enrich_with_adp returns ecr_rank/adp_rank integers and
an ecr_fmt 'round|pick' string per row for the React component.
"""

from __future__ import annotations

import logging

import httpx

from app import cache
from app.data import ecr

logger = logging.getLogger(__name__)

FFC_BASE = "https://fantasyfootballcalculator.com/api/v1/adp"

# Below this many matched players the current-season FFC response is treated as
# "not published yet" and we fall back to the prior season's ADP.
_ADP_SPARSE_THRESHOLD = 24

# FFC format string based on PPR value
def _ffc_format(ppr: float) -> str:
    if ppr >= 1.0:
        return "ppr"
    if ppr >= 0.5:
        return "half-ppr"
    return "standard"


def _cache_key(n_teams: int, ppr: float, year: int | None) -> str:
    from datetime import date
    yr = year if year is not None else "default"
    return f"ffc_adp_{n_teams}_{_ffc_format(ppr)}_{yr}_{date.today()}"


def _fetch_adp_year(n_teams: int, ppr: float, year: int | None, force_refresh: bool) -> dict[str, dict]:
    """Fetch one season of FFC ADP. ``year=None`` lets FFC pick its default season."""
    ck = _cache_key(n_teams, ppr, year)
    if not force_refresh:
        cached = cache.get(ck)
        if cached is not None:
            logger.info("ADP loaded from cache (%d players, year=%s)", len(cached), year)
            return cached

    fmt = _ffc_format(ppr)
    url = f"{FFC_BASE}/{fmt}"
    params: dict[str, int | str] = {"teams": n_teams, "count": 400}
    if year is not None:
        params["year"] = year

    logger.info("Fetching FFC ADP: %s (teams=%d, year=%s)", url, n_teams, year)
    try:
        resp = httpx.get(url, params=params, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("FFC ADP fetch failed (year=%s): %s", year, exc)
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
    logger.info("ADP cached: %d players (year=%s)", len(result), year)
    return result


def fetch_adp(
    n_teams: int,
    ppr: float = 0.5,
    season: int | None = None,
    force_refresh: bool = False,
) -> dict[str, dict]:
    """
    Fetch and cache ADP, with a prior-season fallback.

    Early in the off-season FFC has no usable current-season ADP yet, so the
    current-season response comes back empty/too-sparse. When that happens (and
    a ``season`` is known) we retry once against ``season - 1`` so the board
    still has *some* ADP to show.

    Returns
    -------
    dict mapping espn_id (str) → {
        "adp_rank":   int,
        "player_name": str,
        "pos":         str,
        "team":        str,
        "adp_season":  int | None,   # which season this ADP came from
    }
    Returns empty dict when no season has usable data (ADP is optional; board
    degrades gracefully).
    """
    result = _fetch_adp_year(n_teams, ppr, season, force_refresh)
    used_season = season

    # Fall back to the prior season when the current one isn't published yet.
    if season is not None and len(result) < _ADP_SPARSE_THRESHOLD:
        prior = _fetch_adp_year(n_teams, ppr, season - 1, force_refresh)
        if len(prior) > len(result):
            logger.info(
                "FFC ADP for %s is sparse (%d); falling back to %s (%d)",
                season, len(result), season - 1, len(prior),
            )
            result, used_season = prior, season - 1

    for info in result.values():
        info["adp_season"] = used_season
    return result


def enrich_with_adp(
    player_rows: list[dict],
    n_teams: int,
    ppr: float = 0.5,
    season: int | None = None,
) -> tuple[list[dict], bool, bool]:
    """
    Join ADP (FFC, by espn_id) and ECR (FantasyPros, by sleeper_id) onto rows.

    Adds 'adp_rank', 'ecr_rank', and 'ecr_fmt' (round|pick string) to each row.
    ADP and ECR come from independent sources so the frontend's ADP-vs-ECR
    divergence coloring is meaningful. When FantasyPros ECR is unavailable
    (no API key / upstream down), ECR falls back to the FFC ADP rank — the
    behavior before real ECR existed.

    Returns (enriched_rows, adp_available, ecr_available).
    """
    adp_map = fetch_adp(n_teams, ppr, season)
    ecr_map = ecr.fetch_ecr(season, ppr) if season is not None else {}
    adp_available = bool(adp_map)
    ecr_available = bool(ecr_map)

    for row in player_rows:
        eid = str(row.get("espn_id") or "")
        sid = str(row.get("sleeper_id") or "")
        adp_info = adp_map.get(eid)
        adp_rank = adp_info["adp_rank"] if adp_info else None
        row["adp_rank"] = adp_rank

        # Prefer real FantasyPros ECR; fall back to the ADP rank as a proxy.
        ecr_rank = ecr_map.get(sid)
        if ecr_rank is None:
            ecr_rank = adp_rank
        row["ecr_rank"] = ecr_rank
        row["ecr_fmt"] = _fmt_ecr(ecr_rank, n_teams) if ecr_rank is not None else "—"

    return player_rows, adp_available, ecr_available


def _fmt_ecr(rank: int, n_teams: int) -> str:
    """Format an ECR rank as 'round|pick', e.g. '3|07' for pick 31 in a 12-team league."""
    rd = (rank - 1) // n_teams + 1
    pk = (rank - 1) % n_teams + 1
    return f"{rd}|{pk:02d}"
