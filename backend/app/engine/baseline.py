"""
U6 — Man-games baseline calculator (Frank Dupont / BeerSheets "BEER" method).

games_needed(pos) = n_teams × (starters[pos] + flex_slots × flex_alloc[pos]) × fantasy_weeks

Walk the attrition curve, cumulating games played until the total reaches
games_needed.  The rank at that point is the baseline rank.

Baseline points = mean projected fantasy points of the player at that rank.

Expected output for canonical 12-team 0.5-PPR 1-FLEX:
  QB ≈ 15, RB ≈ 44, WR ≈ 55, TE ≈ 19
"""

from __future__ import annotations

import logging

import numpy as np

from app.config import LeagueConfig, POSITIONS

logger = logging.getLogger(__name__)


def games_needed(pos: str, cfg: LeagueConfig) -> float:
    """Total player-games demanded by the league at a given position."""
    starters = cfg.starters.get(pos, 0)
    flex_share = cfg.flex_slots * cfg.flex_alloc.get(pos, 0.0)
    return cfg.n_teams * (starters + flex_share) * cfg.fantasy_weeks


def baseline_rank(pos: str, cfg: LeagueConfig, curve: list[float]) -> int:
    """
    Walk `curve` accumulating games until games_needed is met.
    Returns the 1-indexed rank of the baseline player.
    """
    need = games_needed(pos, cfg)
    cumulative = 0.0
    for rank, g in enumerate(curve, start=1):
        cumulative += g
        if cumulative >= need:
            return rank
    # If curve runs out, return its length (deepest available)
    return len(curve)


def compute_baselines(
    cfg: LeagueConfig,
    curves: dict[str, list[float]],
    pos_projections: dict[str, list[float]],
) -> dict[str, float]:
    """
    Compute baseline fantasy-point value for each position.

    Parameters
    ----------
    cfg : LeagueConfig
    curves : dict[str, list[float]]
        Attrition curves per position (from historical.load_attrition_curves).
    pos_projections : dict[str, list[float]]
        For each position, a list of mean projected fantasy points sorted descending.
        (These are the ranked player projections used to find baseline points.)

    Returns
    -------
    dict[str, float]
        Baseline points per position.
    """
    baselines: dict[str, float] = {}

    # Only compute baselines for scored positions (config.POSITIONS is the single
    # source of truth).  Kicker is a valid roster slot but has no projection
    # source, so it is excluded here rather than emitting a bogus 0.0 baseline.
    for pos in POSITIONS:
        curve = curves.get(pos, [14.0] * 80)
        br = baseline_rank(pos, cfg, curve)
        proj = pos_projections.get(pos, [])
        if proj:
            # Use the mean points of the player at the baseline rank
            idx = min(br, len(proj)) - 1
            baselines[pos] = max(0.0, proj[idx])
        else:
            baselines[pos] = 0.0

        logger.info(
            "%-3s baseline → rank %2d, %.1f pts  (games_needed=%.0f)",
            pos, br, baselines[pos], games_needed(pos, cfg),
        )

    return baselines
