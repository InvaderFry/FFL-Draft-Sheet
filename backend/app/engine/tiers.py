"""
U8 — Jenks tier assignment.

Assigns a tier number (1 = best tier) to each player within their position
using Jenks natural breaks on the VAL distribution.

N_TIERS_BY_POS: QB/TE → 8, RB/WR → 12, DST/K → 6
(matches beersheet_clone.R and the plan)

Positive players (val > 0) are tiered over k-1 tiers (1 through k-1) using
Jenks. Sub-baseline players (val <= 0) get equal-count rank bands instead:
the VAL distribution just below baseline is dense and the deep tail sparse,
so Jenks would lump everyone near zero into one giant tier. Rank bands keep
the visual tier granularity consistent all the way down the list (like
BeerSheets), numbered contiguously after the last positive tier with no cap.

Edge cases:
- Fewer unique positive values than requested tiers → direct contiguous tier mapping
- All same value in a group → everyone shares one tier
- Equal sub-baseline values never straddle a band boundary
- No positive players → sub-baseline bands start at 1

Also sets tier_is_even (bool) for alternating row shading.
"""

from __future__ import annotations

import logging
from math import ceil

import jenkspy
import numpy as np

from app.config import N_TIERS_BY_POS
from app.engine.vbd import PlayerVBD

logger = logging.getLogger(__name__)


def _jenks_breaks(values: list[float], n_classes: int) -> list[float]:
    """
    Compute Jenks natural breaks. Falls back only for runtime Jenks failures.
    """
    unique = sorted(set(values))
    if len(unique) <= n_classes:
        # Degenerate: return each unique value as its own break
        return unique

    try:
        breaks = jenkspy.jenks_breaks(values, n_classes=n_classes)
        return list(breaks)
    except Exception as exc:
        logger.error("jenkspy failed (%s); tier quality degraded, using equal-interval fallback", exc)
        lo, hi = min(values), max(values)
        step = (hi - lo) / n_classes
        return [lo + i * step for i in range(n_classes + 1)]


def _assign_group_tiers(group: list[PlayerVBD], n_tiers: int, offset: int) -> int:
    """
    Tier `group` (sorted descending by val) into up to `n_tiers` tiers numbered
    offset+1 .. offset+used. Sets p.tier and p.tier_is_even (parity of the
    final global tier number). Returns the highest tier number assigned
    (offset if group is empty).
    """
    if not group:
        return offset

    vals = [p.val for p in group]
    unique_desc = sorted(set(vals), reverse=True)

    # Degenerate case: at most `n_tiers` distinct values.  Jenks/digitize can
    # produce non-contiguous tier numbers here, so map each distinct value to
    # its own tier band directly (highest value → first tier).
    if len(unique_desc) <= n_tiers:
        rank_of_value = {v: tier for tier, v in enumerate(unique_desc, start=1)}
        last_tier = len(unique_desc)
        for p in group:
            t = offset + rank_of_value.get(p.val, last_tier)
            p.tier = t
            p.tier_is_even = (t % 2 == 0)
        return offset + last_tier

    # General case: more distinct values than tiers → Jenks natural breaks.
    breaks = _jenks_breaks(vals, n_tiers)

    # Assign tiers: break[0] < val ≤ break[1] → tier_class 1, etc.
    # We want the first tier = highest VAL, so we reverse the digitize output.
    def val_to_tier(v: float) -> int:
        # np.digitize: returns index of the bucket (1-indexed from left = low)
        bucket = int(np.digitize(v, breaks[1:-1]))  # 0..n_tiers-1
        # Reverse so bucket 0 (lowest) → tier n_tiers (worst tier in group)
        #              bucket n_tiers-1 (highest) → tier 1 (best in group)
        return n_tiers - bucket

    max_assigned = 0
    for p in group:
        t = offset + val_to_tier(p.val)
        p.tier = t
        p.tier_is_even = (t % 2 == 0)
        max_assigned = max(max_assigned, t)

    return max_assigned


def _sub_tier_size(n_positive: int, last_pos_tier: int, n_players: int, k: int) -> int:
    """
    Target band size for sub-baseline tiers: match the average positive tier
    size, floored at 3 so thin positive tiers don't create 1-2 player bands.
    """
    if last_pos_tier:
        return max(3, ceil(n_positive / last_pos_tier))
    return max(3, ceil(n_players / k))


def _assign_rank_band_tiers(group: list[PlayerVBD], band_size: int, offset: int) -> int:
    """
    Tier `group` (sorted descending by val) into equal-count bands of
    `band_size` players, extending a band so equal values never straddle a
    boundary. Tiers are numbered offset+1, offset+2, ... Returns the highest
    tier number assigned (offset if group is empty).
    """
    tier = offset
    in_band = band_size  # force a new band on the first player
    for i, p in enumerate(group):
        starts_new_band = in_band >= band_size and (i == 0 or p.val != group[i - 1].val)
        if starts_new_band:
            tier += 1
            in_band = 0
        p.tier = tier
        p.tier_is_even = (tier % 2 == 0)
        in_band += 1
    return tier


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

    positive_players = [p for p in players if p.val > 0]
    sub_players = [p for p in players if p.val <= 0]

    last_pos_tier = _assign_group_tiers(positive_players, max(1, k - 1), offset=0)

    if sub_players:
        target = _sub_tier_size(len(positive_players), last_pos_tier, len(players), k)
        _assign_rank_band_tiers(sub_players, target, offset=last_pos_tier)

    return players
