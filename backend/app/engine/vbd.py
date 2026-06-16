"""
U7 — VBD aggregation.

Groups per-source fantasy-point projections by player, computes mean + sd,
then subtracts the positional baseline to produce:

  VAL   = mean - baseline
  Floor = (mean - outcome_band) - baseline
  Ceil  = (mean + outcome_band) - baseline

Floor/Ceil use historical weekly outcome variance when available:
player CV × mean, then position-median CV × mean for known historical
identities with too little player-specific data, then source-sigma when no
variance data or no historical identity is available. Cross-source sd is still
computed and serialized as a projection-disagreement diagnostic.

Returns a list of PlayerVBD dicts sorted descending by VAL within each position.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.data.players import canonical_key

logger = logging.getLogger(__name__)

SD_FALLBACK_RATIO = 0.12  # sd = 12% of mean for single-source players
DEFAULT_OUTCOME_CV = 0.45


@dataclass(kw_only=True)
class PlayerVBD:
    sleeper_id: str | None
    espn_id: str | None
    gsis_id: str | None = None
    player_name: str
    pos: str
    team: str
    bye_week: int | None
    mean_pts: float
    sd_pts: float
    n_sources: int
    baseline: float
    val: float       # mean - baseline; negative values are intentional
    floor: float     # (mean - outcome_band) - baseline
    ceil: float      # (mean + outcome_band) - baseline
    pos_rank: int = 0
    # ADP fields (filled later by adp.enrich_with_adp)
    adp_rank: int | None = None
    ecr_rank: int | None = None
    ecr_fmt: str = "—"
    # Tier and scarcity (filled later)
    tier: int = 1
    tier_is_even: bool = False
    ps_pct: float = 0.0
    auction_price: float | None = None
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sleeper_id": self.sleeper_id,
            "espn_id": self.espn_id,
            "player_name": self.player_name,
            "pos": self.pos,
            "team": self.team,
            "bye_week": self.bye_week,
            "mean_pts": round(self.mean_pts, 1),
            "baseline": round(self.baseline, 1),
            "sd_pts": round(self.sd_pts, 1),
            "n_sources": self.n_sources,
            "val": round(self.val, 1),
            "floor": round(self.floor, 1),
            "ceil": round(self.ceil, 1),
            "pos_rank": self.pos_rank,
            "adp_rank": self.adp_rank,
            "ecr_rank": self.ecr_rank,
            "ecr_fmt": self.ecr_fmt,
            "tier": self.tier,
            "tier_is_even": self.tier_is_even,
            "ps_pct": round(self.ps_pct * 100, 1),
            "auction_price": round(self.auction_price, 0) if self.auction_price is not None else None,
        }


def aggregate_projections(
    raw_rows: list[dict],
    pos: str,
    baseline: float,
    player_info_map: dict | None = None,
    variance: dict | None = None,
) -> list[PlayerVBD]:
    """
    Aggregate multi-source rows for one position into PlayerVBD objects.

    Parameters
    ----------
    raw_rows : list[dict]
        Output of scraper.scrape_position() for this position.
        Each dict has at minimum: player_name, team, sleeper_id, points, source.
    pos : str
    baseline : float
        Baseline fantasy points for this position.
    player_info_map : dict | None
        Optional mapping sleeper_id → PlayerRecord for bye-week and GSIS lookup.
    variance : dict | None
        Optional weekly CV data from data.variance.load_variance().

    Returns
    -------
    list[PlayerVBD] sorted descending by VAL, with pos_rank populated.
    """
    if not raw_rows:
        return []

    # Group rows by canonical player identity (prefer sleeper_id; fall back to name+team)
    groups: dict[str, list[float]] = {}
    meta: dict[str, dict] = {}

    for row in raw_rows:
        sid = row.get("sleeper_id")
        name = row.get("player_name", "").strip()
        team = row.get("team", "").strip()
        eid = row.get("espn_id")
        pts = float(row.get("points", 0))
        key = canonical_key(row)

        groups.setdefault(key, []).append(pts)
        if key not in meta:
            meta[key] = {
                "sleeper_id": sid,
                "espn_id": eid,
                "gsis_id": row.get("gsis_id"),
                "player_name": name,
                "team": team,
            }
        else:
            # Prefer non-null IDs
            if not meta[key]["sleeper_id"] and sid:
                meta[key]["sleeper_id"] = sid
            if not meta[key]["espn_id"] and eid:
                meta[key]["espn_id"] = eid
            if not meta[key]["gsis_id"] and row.get("gsis_id"):
                meta[key]["gsis_id"] = row.get("gsis_id")

    records: list[PlayerVBD] = []
    for key, pts_list in groups.items():
        m = meta[key]
        arr = np.array(pts_list, dtype=float)
        mean = float(arr.mean())
        n = len(arr)
        sd = float(arr.std(ddof=min(1, n - 1))) if n > 1 else SD_FALLBACK_RATIO * abs(mean)

        # Look up bye week and GSIS ID from player_info_map if available
        bye = None
        gsis_id = m.get("gsis_id")
        sid = m.get("sleeper_id")
        if player_info_map and sid and sid in player_info_map:
            rec = player_info_map[sid]
            bye = getattr(rec, "bye_week", None)
            gsis_id = getattr(rec, "gsis_id", None) or gsis_id

        val = mean - baseline
        band = sd
        if variance is not None and variance.get("available", True):
            if mean <= 0:
                band = 0.0
            elif gsis_id:
                player_cv = variance.get("player_cv", {}).get(str(gsis_id))
                if player_cv is not None:
                    band = float(player_cv) * mean
                else:
                    pos_cv = variance.get("pos_median_cv", {}).get(pos, DEFAULT_OUTCOME_CV)
                    band = float(pos_cv) * mean

        floor_ = (mean - band) - baseline
        ceil_ = (mean + band) - baseline

        records.append(PlayerVBD(
            sleeper_id=sid,
            espn_id=m.get("espn_id"),
            gsis_id=gsis_id,
            player_name=m["player_name"],
            pos=pos,
            team=m["team"],
            bye_week=bye,
            mean_pts=mean,
            sd_pts=sd,
            n_sources=n,
            baseline=baseline,
            val=val,
            floor=floor_,
            ceil=ceil_,
        ))

    # Sort descending by VAL (then mean_pts as tiebreak)
    records.sort(key=lambda r: (-r.val, -r.mean_pts))
    for i, rec in enumerate(records, start=1):
        rec.pos_rank = i

    return records
