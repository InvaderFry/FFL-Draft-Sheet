"""
U8 — Jenks tier assignment.

Assigns a tier number (1 = best tier) to each player within their position
using Jenks natural breaks on the VAL distribution.

N_TIERS_BY_POS: QB/TE → 8, RB/WR → 12, DST/K → 6
(matches beersheet_clone.R and the plan)

Edge cases:
- Fewer unique values than requested tiers → direct contiguous tier mapping
- All same value → everyone tier 1

Also sets tier_is_even (bool) for alternating row shading.
"""

from __future__ import annotations

import logging

import numpy as np

from app.config import N_TIERS_BY_POS
from app.engine.vbd import PlayerVBD

logger = logging.getLogger(__name__)


def _jenks_breaks(values: list[float], n_classes: int) -> list[float]:
    """
    Compute Jenks natural breaks.  Prefers jenkspy; falls back to equal-interval.
    """
    unique = sorted(set(values))
    if len(unique) <= n_classes:
        # Degenerate: return each unique value as its own break
        return unique

    try:
        import jenkspy  # type: ignore
        breaks = jenkspy.jenks_breaks(values, n_classes=n_classes)
        return list(breaks)
    except Exception as exc:
        logger.warning("jenkspy failed (%s); using equal-interval fallback", exc)
        lo, hi = min(values), max(values)
        step = (hi - lo) / n_classes
        return [lo + i * step for i in range(n_classes + 1)]


def assign_tiers(players: list[PlayerVBD]) -> list[PlayerVBD]:
    """
    Assign tier and tier_is_even to each player in the list (mutates in place).

    The list must already be sorted descending by VAL (as produced by vbd.aggregate_projections).
    Tier 1 is the highest-value tier.
    """
    if not players:
        return players

    pos = players[0].pos
    k = N_TIERS_BY_POS.get(pos, 8)
    vals = [p.val for p in players]

    unique_desc = sorted(set(vals), reverse=True)

    # Degenerate case: at most `k` distinct values.  Jenks/digitize can
    # produce non-contiguous tier numbers here, so map each distinct value to its
    # own tier band directly (highest value → tier 1).
    if len(unique_desc) <= k:
        rank_of_value = {v: tier for tier, v in enumerate(unique_desc, start=1)}
        last_tier = len(unique_desc)
        for p in players:
            t = rank_of_value.get(p.val, last_tier)
            p.tier = t
            p.tier_is_even = (t % 2 == 0)
        return players

    # General case: more distinct values than tiers → Jenks natural breaks.
    breaks = _jenks_breaks(vals, k)

    # Assign tiers: break[0] < val ≤ break[1] → tier_class 1, etc.
    # We want tier 1 = highest VAL, so we reverse the digitize output.
    def val_to_tier(v: float) -> int:
        # np.digitize: returns index of the bucket (1-indexed from left = low)
        bucket = int(np.digitize(v, breaks[1:-1]))  # 0..k-1
        # Reverse so bucket 0 (lowest) → tier k (worst)
        #              bucket k-1 (highest) → tier 1 (best)
        return k - bucket

    for p in players:
        t = val_to_tier(p.val)
        p.tier = t
        p.tier_is_even = (t % 2 == 0)

    return players
