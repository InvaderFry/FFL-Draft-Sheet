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
from math import ceil, log, sqrt
from typing import Callable

import jenkspy
import numpy as np

from app.config import N_TIERS_BY_POS
from app.engine.vbd import PlayerVBD

logger = logging.getLogger(__name__)

# A breaks function maps (values, n_classes) → an ascending list of break
# points [min, b1, ..., b_{n-1}, max] (n_classes+1 entries in the general case),
# matching jenkspy's contract so all methods reuse the same digitize machinery.
BreaksFn = Callable[[list[float], int], list[float]]


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


def _gaussian_boundary(
    m1: float, v1: float, w1: float, m2: float, v2: float, w2: float
) -> float | None:
    """
    Decision boundary between two weighted 1-D Gaussians (component 1 has the
    lower mean, m1 < m2): the x where w1·N(x|m1,v1) == w2·N(x|m2,v2). Returns
    the root lying in [m1, m2], or None when there is no such crossing.
    """
    k = (log(w1) - 0.5 * log(v1)) - (log(w2) - 0.5 * log(v2))
    a = 1.0 / (2 * v2) - 1.0 / (2 * v1)
    b = m1 / v1 - m2 / v2
    c = m2 * m2 / (2 * v2) - m1 * m1 / (2 * v1) + k

    if abs(a) < 1e-12:
        if abs(b) < 1e-12:
            return None
        return -c / b

    disc = b * b - 4 * a * c
    if disc < 0:
        return None
    s = sqrt(disc)
    for root in ((-b + s) / (2 * a), (-b - s) / (2 * a)):
        if m1 <= root <= m2:
            return root
    return None


def _gmm_breaks(values: list[float], n_classes: int) -> list[float]:
    """
    GMM-based natural breaks (Boris-Chen-style). Fits a 1-D Gaussian mixture
    with `n_classes` components via EM, then returns the decision boundaries
    between consecutive (mean-ordered) components as breaks. This yields exactly
    n_classes-1 monotonically increasing internal breaks, so the existing
    digitize-and-reverse machinery produces contiguous, monotonic tiers.

    Falls back to Jenks breaks on any numerical failure.
    """
    unique = sorted(set(values))
    if len(unique) <= n_classes:
        return unique

    try:
        return _gmm_breaks_impl(values, n_classes)
    except Exception as exc:
        logger.warning("GMM tiering failed (%s); falling back to Jenks breaks", exc)
        return _jenks_breaks(values, n_classes)


def _gmm_breaks_impl(values: list[float], n_classes: int) -> list[float]:
    x = np.sort(np.asarray(values, dtype=float))
    n = x.size
    k = n_classes

    # Initialise: means at interior quantiles, equal weights, shared variance.
    means = np.quantile(x, np.linspace(0.0, 1.0, k + 2)[1:-1])
    var = np.full(k, max(float(np.var(x)) / k, 1e-6))
    weights = np.full(k, 1.0 / k)

    for _ in range(200):
        # E-step in the log domain for numerical stability.
        diff = x[:, None] - means[None, :]
        log_g = -0.5 * (np.log(2 * np.pi * var)[None, :] + diff**2 / var[None, :])
        log_r = log_g + np.log(weights)[None, :]
        log_r -= log_r.max(axis=1, keepdims=True)
        resp = np.exp(log_r)
        resp /= resp.sum(axis=1, keepdims=True)

        # M-step.
        nk = resp.sum(axis=0) + 1e-9
        new_means = (resp * x[:, None]).sum(axis=0) / nk
        new_var = np.maximum(
            (resp * (x[:, None] - new_means[None, :]) ** 2).sum(axis=0) / nk, 1e-6
        )
        new_weights = nk / n

        converged = np.max(np.abs(new_means - means)) < 1e-7
        means, var, weights = new_means, new_var, new_weights
        if converged:
            break

    order = np.argsort(means)
    means, var, weights = means[order], var[order], weights[order]

    lo, hi = float(x[0]), float(x[-1])
    cleaned: list[float] = []
    prev = lo
    for i in range(k - 1):
        b = _gaussian_boundary(
            means[i], var[i], weights[i], means[i + 1], var[i + 1], weights[i + 1]
        )
        if b is None or not (means[i] <= b <= means[i + 1]):
            b = 0.5 * (means[i] + means[i + 1])
        b = min(max(float(b), lo), hi)
        if b < prev:
            b = prev  # keep non-decreasing so digitize stays well-defined
        cleaned.append(b)
        prev = b

    return [lo] + cleaned + [hi]


def _assign_group_tiers(
    group: list[PlayerVBD],
    n_tiers: int,
    offset: int,
    breaks_fn: BreaksFn,
    method: str,
) -> int:
    """
    Tier `group` (sorted descending by val) into up to `n_tiers` tiers numbered
    offset+1 .. offset+used using `breaks_fn` (e.g. Jenks or GMM). Writes the
    tier number into p.tiers[method]. Returns the highest tier number assigned
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
            p.tiers[method] = t
        return offset + last_tier

    # General case: more distinct values than tiers → natural breaks.
    breaks = breaks_fn(vals, n_tiers)

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
        p.tiers[method] = t
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


def _assign_rank_band_tiers(
    group: list[PlayerVBD], band_size: int, offset: int, method: str
) -> int:
    """
    Tier `group` (sorted descending by val) into equal-count bands of
    `band_size` players, extending a band so equal values never straddle a
    boundary. Tiers are numbered offset+1, offset+2, ... and written into
    p.tiers[method]. Returns the highest tier number assigned (offset if empty).
    """
    tier = offset
    in_band = band_size  # force a new band on the first player
    for i, p in enumerate(group):
        starts_new_band = in_band >= band_size and (i == 0 or p.val != group[i - 1].val)
        if starts_new_band:
            tier += 1
            in_band = 0
        p.tiers[method] = tier
        in_band += 1
    return tier


# Registry of tier methods → breaks function. Each method gets its own entry in
# every player's `tiers` map; the default is mirrored into the flat
# tier/tier_is_even fields for back-compat. Add new computed methods here.
TIER_METHODS: dict[str, BreaksFn] = {
    "jenks": _jenks_breaks,
    "gmm": _gmm_breaks,
}
DEFAULT_TIER_METHOD = "jenks"


def assign_tiers(players: list[PlayerVBD]) -> list[PlayerVBD]:
    """
    Assign tiers to each player (mutates in place). Every method in
    TIER_METHODS is computed into p.tiers[method]; the default method is also
    mirrored into the flat p.tier / p.tier_is_even fields for back-compat.

    The list must already be sorted descending by VAL (as produced by
    vbd.aggregate_projections). Tier 1 is the highest-value tier.
    """
    if not players:
        return players

    pos = players[0].pos
    k = N_TIERS_BY_POS.get(pos, 8)

    positive_players = [p for p in players if p.val > 0]
    sub_players = [p for p in players if p.val <= 0]

    for method, breaks_fn in TIER_METHODS.items():
        last_pos_tier = _assign_group_tiers(
            positive_players, max(1, k - 1), offset=0, breaks_fn=breaks_fn, method=method
        )
        if sub_players:
            target = _sub_tier_size(len(positive_players), last_pos_tier, len(players), k)
            _assign_rank_band_tiers(sub_players, target, offset=last_pos_tier, method=method)

    # Back-compat: mirror the default method into the flat tier fields.
    for p in players:
        p.tier = p.tiers.get(DEFAULT_TIER_METHOD, 1)
        p.tier_is_even = p.tier % 2 == 0

    return players
