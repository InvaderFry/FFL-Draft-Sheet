"""
U5 — Historical stats loader / attrition curve builder.

Builds a per-position attrition curve:
    curve[pos] = [avg_games_at_rank_1, avg_games_at_rank_2, ..., avg_games_at_rank_N]

Uses nfl_data_py seasonal data from the last 3 seasons.
Falls back to a constant 14.0 games/player if the pull fails.
"""

from __future__ import annotations

import logging
from datetime import date

import numpy as np

from app import cache

logger = logging.getLogger(__name__)

MAX_RANK = 80
DEFAULT_GAMES = 14.0
POSITIONS = ["QB", "RB", "WR", "TE", "DST", "K"]

_GSIS_TO_POS_KEY = {
    "QB": "qb",
    "RB": "rb",
    "WR": "wr",
    "TE": "te",
}


def _fallback_curve() -> list[float]:
    """Returns a flat curve (used when historical data is unavailable)."""
    return [DEFAULT_GAMES] * MAX_RANK


def _build_curves_from_nfl_data(season: int) -> dict[str, list[float]]:
    """
    Pull seasonal stats from nfl_data_py for the 3 seasons before `season`.
    Returns {pos: [avg_games_at_rank_i]} for ranks 1..MAX_RANK.
    """
    seasons = list(range(season - 3, season))
    logger.info("Loading nfl_data_py seasonal data for seasons %s", seasons)

    try:
        import nfl_data_py as nfl  # type: ignore
        df = nfl.import_seasonal_data(seasons)
    except Exception as exc:
        logger.warning("nfl_data_py load failed: %s — using fallback curve", exc)
        return {pos: _fallback_curve() for pos in POSITIONS}

    if df is None or df.empty:
        logger.warning("nfl_data_py returned empty frame — using fallback curve")
        return {pos: _fallback_curve() for pos in POSITIONS}

    curves: dict[str, list[float]] = {}

    # Columns we care about
    need_cols = {"season", "player_id", "position", "games"}
    # Handle different nfl_data_py column names
    col_map = {}
    for col in df.columns:
        lc = col.lower()
        if lc in ("season", "player_season"):
            col_map["season"] = col
        elif lc in ("player_id", "gsis_id", "id"):
            col_map["player_id"] = col
        elif lc in ("position", "pos"):
            col_map["position"] = col
        elif lc in ("games", "games_played", "g"):
            col_map["games"] = col
        elif "fantasy" in lc and "point" in lc:
            col_map["fpts"] = col

    if not all(k in col_map for k in ("season", "player_id", "position", "games")):
        logger.warning("nfl_data_py columns not as expected: %s — fallback", list(df.columns))
        return {pos: _fallback_curve() for pos in POSITIONS}

    df = df.rename(columns={v: k for k, v in col_map.items() if k != v})
    df["position"] = df["position"].str.upper()

    # Choose the fantasy points column
    fpts_col = col_map.get("fpts")
    if not fpts_col:
        # pick the column with "fantasy" in the name
        candidates = [c for c in df.columns if "fantasy" in c.lower()]
        fpts_col = candidates[0] if candidates else None

    if fpts_col:
        df = df.rename(columns={fpts_col: "fpts"})
    else:
        df["fpts"] = 0.0

    for pos in POSITIONS:
        if pos == "DST" or pos == "K":
            # Limited historical data; use fallback
            curves[pos] = _fallback_curve()
            continue

        pos_df = df[df["position"] == pos].copy()
        if pos_df.empty:
            curves[pos] = _fallback_curve()
            continue

        # Rank each player within their season by fpts descending
        pos_df["rank"] = (
            pos_df.groupby("season")["fpts"]
            .rank(method="first", ascending=False)
            .astype(int)
        )

        # Average games played at each rank across seasons
        rank_games = (
            pos_df.groupby("rank")["games"]
            .mean()
            .sort_index()
        )

        curve: list[float] = []
        for r in range(1, MAX_RANK + 1):
            g = float(rank_games.get(r, DEFAULT_GAMES))
            g = max(1.0, min(17.0, g))  # sanity clamp
            curve.append(g)

        # Light smoothing: 3-rank rolling mean
        arr = np.array(curve)
        smooth = np.convolve(arr, np.ones(3) / 3, mode="same")
        smooth[0] = arr[0]
        smooth[-1] = arr[-1]
        curves[pos] = [round(float(v), 2) for v in smooth]

    return curves


def load_attrition_curves(season: int, force_refresh: bool = False) -> dict[str, list[float]]:
    """
    Return the attrition curve dict, using file cache when available.

    Cache key includes the season year so pre-season 2026 data ≠ 2027 data.
    """
    ck = f"attrition_curves_{season}"
    if not force_refresh:
        cached = cache.get(ck)
        if cached is not None:
            logger.info("Attrition curves loaded from cache (season=%d)", season)
            return cached

    curves = _build_curves_from_nfl_data(season)
    cache.set(ck, curves)
    logger.info("Attrition curves built and cached (season=%d)", season)
    return curves
