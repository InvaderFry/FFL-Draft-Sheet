"""
Weekly outcome variance loader.

Builds player and position coefficient-of-variation (CV) values from recent
nfl_data_py weekly logs. These CVs drive draft floor/ceiling bands.
"""

from __future__ import annotations

import logging
from statistics import median
from typing import Any

import pandas as pd

from app import cache
from app.config import POSITIONS

logger = logging.getLogger(__name__)

MIN_GAMES = 8
WEEKLY_SEASONS = 3
CV_CLAMP = (0.20, 0.80)
DEFAULT_POSITION_CV = 0.45


def _fallback_variance() -> dict[str, Any]:
    return {
        "available": False,
        "player_cv": {},
        "pos_median_cv": {pos: DEFAULT_POSITION_CV for pos in POSITIONS},
    }


def _resolve_columns(df: pd.DataFrame) -> dict[str, str]:
    col_map: dict[str, str] = {}
    for col in df.columns:
        lc = col.lower()
        if lc in ("player_id", "gsis_id", "id"):
            col_map.setdefault("player_id", col)
        elif lc in ("position", "recent_team_position", "pos"):
            col_map.setdefault("position", col)
        elif lc == "fantasy_points_ppr":
            col_map["points"] = col
        elif lc == "fantasy_points" and "points" not in col_map:
            col_map["points"] = col
        elif lc in ("season_type", "game_type"):
            col_map.setdefault("season_type", col)
    return col_map


def _clamp_cv(value: float) -> float:
    lo, hi = CV_CLAMP
    return max(lo, min(hi, value))


def _build_cv_from_nfl_data(season: int) -> dict[str, Any]:
    seasons = list(range(season - WEEKLY_SEASONS, season))
    logger.info("Loading nfl_data_py weekly data for seasons %s", seasons)

    try:
        import nfl_data_py as nfl  # type: ignore

        df = nfl.import_weekly_data(seasons)
    except Exception as exc:
        logger.warning("nfl_data_py weekly load failed: %s; using fallback variance", exc)
        return _fallback_variance()

    if df is None or df.empty:
        logger.warning("nfl_data_py weekly data empty; using fallback variance")
        return _fallback_variance()

    col_map = _resolve_columns(df)
    required = ("player_id", "position", "points")
    if not all(k in col_map for k in required):
        logger.warning("nfl_data_py weekly columns not as expected: %s; using fallback variance", list(df.columns))
        return _fallback_variance()

    work = df.rename(columns={col_map[k]: k for k in required}).copy()
    if "season_type" in col_map:
        work = work.rename(columns={col_map["season_type"]: "season_type"})
        work = work[work["season_type"].astype(str).str.upper().isin({"REG", "REGULAR"})]

    work = work[["player_id", "position", "points"]].copy()
    work = work[work["points"].notna()]
    work["player_id"] = work["player_id"].astype(str)
    work["position"] = work["position"].astype(str).str.upper()
    work["points"] = pd.to_numeric(work["points"], errors="coerce")
    work = work[work["points"].notna()]

    player_cv: dict[str, float] = {}
    pos_samples: dict[str, list[float]] = {pos: [] for pos in POSITIONS}

    for (player_id, pos), group in work.groupby(["player_id", "position"]):
        if pos not in pos_samples:
            continue
        points = group["points"]
        n = int(points.count())
        mean = float(points.mean())
        if n < MIN_GAMES or mean <= 0:
            continue
        sd = float(points.std(ddof=1))
        cv = _clamp_cv(sd / mean)
        player_cv[str(player_id)] = cv
        pos_samples[pos].append(cv)

    pos_median_cv = {
        pos: float(median(samples)) if samples else DEFAULT_POSITION_CV
        for pos, samples in pos_samples.items()
    }

    return {"available": True, "player_cv": player_cv, "pos_median_cv": pos_median_cv}


def load_variance(season: int, force_refresh: bool = False) -> dict[str, Any]:
    """
    Return cached weekly CV data for the last completed seasons before `season`.

    Cache key includes the requested sheet season because a 2026 draft should use
    2023-2025 outcomes, while 2027 should use 2024-2026.
    """
    ck = f"weekly_cv_{season}"
    if not force_refresh:
        cached = cache.get(ck)
        if cached is not None:
            logger.info("Weekly CV variance loaded from cache (season=%d)", season)
            return cached

    variance = _build_cv_from_nfl_data(season)
    cache.set(ck, variance)
    logger.info("Weekly CV variance built and cached (season=%d)", season)
    return variance
