"""
U4 — Scoring engine.

Pure, side-effect-free function that maps a raw stat dict to fantasy points
using a ScoringConfig. Used by the scraper adapters before VBD aggregation.

stat key conventions (snake_case, matching what scraper adapters produce):
  pass_yds, pass_td, interception, pass_2pt
  rush_yds, rush_td, rush_2pt
  rec, rec_yds, rec_td, rec_2pt
  te_premium_eligible  (bool, set by scraper for TE-position players)
  fumble_lost
  first_down_rush, first_down_rec
  dst_sack, dst_int, dst_fumble_rec, dst_safety, dst_td, dst_pa
"""

from __future__ import annotations

from app.config import ScoringConfig


def _dst_pa_points(pa: float, cfg: ScoringConfig) -> float:
    """Convert DST points-allowed into fantasy points using bracket scoring."""
    if pa <= 0:
        return cfg.dst_pa_0
    if pa <= 6:
        return cfg.dst_pa_1_6
    if pa <= 13:
        return cfg.dst_pa_7_13
    if pa <= 20:
        return cfg.dst_pa_14_20
    if pa <= 27:
        return cfg.dst_pa_21_27
    if pa <= 34:
        return cfg.dst_pa_28_34
    return cfg.dst_pa_35_plus


def score(stats: dict, cfg: ScoringConfig) -> float:
    """
    Compute total fantasy points for one player-season projection.

    Parameters
    ----------
    stats : dict
        Raw stat projections.  Unknown keys are silently ignored.
    cfg   : ScoringConfig
        League scoring settings.

    Returns
    -------
    float  — total projected fantasy points.
    """
    g = stats.get

    pts = 0.0

    # Passing
    pts += g("pass_yds", 0) * cfg.pass_yds
    pts += g("pass_td", 0) * cfg.pass_td
    pts += g("interception", 0) * cfg.interception
    pts += g("pass_2pt", 0) * cfg.pass_2pt

    # Rushing
    pts += g("rush_yds", 0) * cfg.rush_yds
    pts += g("rush_td", 0) * cfg.rush_td
    pts += g("rush_2pt", 0) * cfg.rush_2pt

    # Receiving
    rec_count = g("rec", 0)
    pts += rec_count * cfg.rec
    pts += g("rec_yds", 0) * cfg.rec_yds
    pts += g("rec_td", 0) * cfg.rec_td
    pts += g("rec_2pt", 0) * cfg.rec_2pt

    # TE premium (extra per-reception bonus for eligible TEs)
    if g("te_premium_eligible", False):
        pts += rec_count * cfg.te_premium

    # Bonuses
    pts += g("fumble_lost", 0) * cfg.fumble_lost
    pts += g("first_down_rush", 0) * cfg.first_down_rush
    pts += g("first_down_rec", 0) * cfg.first_down_rec

    # DST
    pts += g("dst_sack", 0) * cfg.dst_sack
    pts += g("dst_int", 0) * cfg.dst_int
    pts += g("dst_fumble_rec", 0) * cfg.dst_fumble_rec
    pts += g("dst_safety", 0) * cfg.dst_safety
    pts += g("dst_td", 0) * cfg.dst_td
    if "dst_pa" in stats:
        pts += _dst_pa_points(g("dst_pa", 27), cfg)

    return round(pts, 4)
