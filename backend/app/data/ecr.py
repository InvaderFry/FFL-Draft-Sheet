"""
U11b — ECR loader.

Fetches *real* Expert Consensus Rankings from FantasyPros' consensus-rankings
API (FantasyPros coined the term "ECR") and joins them onto player rows via the
Sleeper name→id crosswalk.

This is intentionally separate from the FFC ADP source (data/adp.py): ADP is
"where players actually get drafted", ECR is "where experts rank them". Keeping
them independent is what makes the board's ADP-vs-ECR divergence coloring
meaningful (frontend/src/utils/ecrColor.js).

FantasyPros API:
  GET https://api.fantasypros.com/public/v2/json/nfl/{season}/consensus-rankings
      ?type=draft&scoring={STD|HALF|PPR}&position=ALL&week=0
  header: x-api-key: <FANTASYPROS_API_KEY>

Returns a dict mapping sleeper_id (str) → ecr_rank (int).
The whole pipeline is env-gated: with no API key (or on any upstream failure) it
returns {} and the board falls back to FFC ADP-as-ECR (data/adp.py), exactly as
before this source existed.
"""

from __future__ import annotations

import logging
import os

import httpx

from app import cache
from app.data.players import find_player

logger = logging.getLogger(__name__)

FP_BASE = "https://api.fantasypros.com/public/v2/json/nfl"
API_KEY_ENV = "FANTASYPROS_API_KEY"


def _fp_scoring(ppr: float) -> str:
    """Map a league's PPR value to FantasyPros' scoring code.

    Mirrors the thresholds in adp._ffc_format so ADP and ECR agree on format.
    """
    if ppr >= 1.0:
        return "PPR"
    if ppr >= 0.5:
        return "HALF"
    return "STD"


def _cache_key(season: int, scoring: str) -> str:
    from datetime import date
    return f"fp_ecr_{scoring}_{season}_{date.today()}"


def fetch_ecr(season: int, ppr: float = 0.5, force_refresh: bool = False) -> dict[str, int]:
    """
    Fetch and cache FantasyPros consensus rankings.

    Returns
    -------
    dict mapping sleeper_id (str) → ecr_rank (int).
    Returns an empty dict when no API key is configured or on any failure
    (ECR is optional; the board degrades gracefully to FFC ADP-as-ECR).
    """
    scoring = _fp_scoring(ppr)
    ck = _cache_key(season, scoring)
    if not force_refresh:
        cached = cache.get(ck)
        if cached is not None:
            logger.info("ECR loaded from cache (%d players)", len(cached))
            return cached

    api_key = os.environ.get(API_KEY_ENV)
    if not api_key:
        logger.info("ECR skipped: %s not set (falling back to ADP-as-ECR)", API_KEY_ENV)
        return {}

    url = f"{FP_BASE}/{season}/consensus-rankings"
    params = {"type": "draft", "scoring": scoring, "position": "ALL", "week": 0}
    headers = {"x-api-key": api_key}

    logger.info("Fetching FantasyPros ECR: %s (scoring=%s)", url, scoring)
    try:
        resp = httpx.get(url, params=params, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("FantasyPros ECR fetch failed: %s", exc)
        return {}

    players = data.get("players", []) if isinstance(data, dict) else []
    result: dict[str, int] = {}
    for p in players:
        if not isinstance(p, dict):
            continue
        rank = p.get("rank_ecr")
        name = p.get("player_name", "")
        pos = (p.get("player_position_id") or "").upper()
        team = p.get("player_team_id", "") or ""
        if rank is None or not name:
            continue
        try:
            rank_i = int(rank)
        except (TypeError, ValueError):
            continue
        rec = find_player(name, pos, team)
        if rec and rec.sleeper_id:
            # First write wins: consensus rankings are pre-sorted, so a duplicate
            # name resolving to the same id keeps the better (earlier) rank.
            result.setdefault(rec.sleeper_id, rank_i)

    cache.set(ck, result)
    logger.info("ECR cached: %d players", len(result))
    return result
