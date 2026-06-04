"""
League settings schema — the single config object that drives the entire pipeline.
All values here are validated by Pydantic before any computation begins.
"""

from __future__ import annotations

from typing import Annotated
from pydantic import BaseModel, Field, model_validator


# Positions the pipeline actually scrapes and scores.  This is the single source
# of truth for "scored positions" — the scraper, attrition curves, baselines, and
# player-map ingestion all derive from it.  Kicker (K) is accepted in LeagueConfig
# for forward-compatibility but has no projection source yet, so it is excluded.
POSITIONS = ["QB", "RB", "WR", "TE", "DST"]

# --------------------------------------------------------------------------- #
# Per-position tier count constants (R6)
# --------------------------------------------------------------------------- #
N_TIERS_BY_POS: dict[str, int] = {
    "QB": 8,
    "RB": 12,
    "WR": 12,
    "TE": 8,
    "DST": 6,
}


class ScoringConfig(BaseModel):
    """Fantasy scoring rules for a single league."""

    # Passing
    pass_yds: float = Field(default=0.04, description="Points per passing yard")
    pass_td: float = Field(default=4.0, description="Points per passing TD")
    interception: float = Field(default=-2.0, description="Points per INT")
    pass_2pt: float = Field(default=2.0, description="Points per passing 2-pt conversion")

    # Rushing
    rush_yds: float = Field(default=0.1, description="Points per rushing yard")
    rush_td: float = Field(default=6.0, description="Points per rushing TD")
    rush_2pt: float = Field(default=2.0, description="Points per rushing 2-pt")

    # Receiving
    rec: float = Field(default=0.5, description="Points per reception (PPR value)")
    rec_yds: float = Field(default=0.1, description="Points per receiving yard")
    rec_td: float = Field(default=6.0, description="Points per receiving TD")
    rec_2pt: float = Field(default=2.0, description="Points per receiving 2-pt")

    # TE premium (optional bonus per reception for TEs)
    te_premium: float = Field(default=0.0, description="Extra PPR bonus for TE receptions")

    # Bonuses
    fumble_lost: float = Field(default=-2.0, description="Points per fumble lost")
    first_down_rush: float = Field(default=0.0, description="Points per rushing first down")
    first_down_rec: float = Field(default=0.0, description="Points per receiving first down")

    # DST scoring (aggregated from source projections as-is)
    dst_sack: float = Field(default=1.0)
    dst_int: float = Field(default=2.0)
    dst_fumble_rec: float = Field(default=2.0)
    dst_safety: float = Field(default=2.0)
    dst_td: float = Field(default=6.0)
    dst_pa_0: float = Field(default=10.0, description="DST points if PA = 0")
    dst_pa_1_6: float = Field(default=7.0, description="DST points if PA 1-6")
    dst_pa_7_13: float = Field(default=4.0, description="DST points if PA 7-13")
    dst_pa_14_20: float = Field(default=1.0, description="DST points if PA 14-20")
    dst_pa_21_27: float = Field(default=0.0, description="DST points if PA 21-27")
    dst_pa_28_34: float = Field(default=-1.0, description="DST points if PA 28-34")
    dst_pa_35_plus: float = Field(default=-4.0, description="DST points if PA 35+")


class LeagueConfig(BaseModel):
    """Full league configuration submitted by the user via POST /api/sheet."""

    season: int = Field(default=2026, ge=2020, le=2030)
    n_teams: int = Field(default=12, ge=8, le=16)
    fantasy_weeks: int = Field(default=14, ge=10, le=18)

    # Starter slots per position
    qb: int = Field(default=1, ge=0, le=3, alias="QB")
    rb: int = Field(default=2, ge=0, le=4, alias="RB")
    wr: int = Field(default=3, ge=0, le=5, alias="WR")
    te: int = Field(default=1, ge=0, le=2, alias="TE")
    dst: int = Field(default=1, ge=0, le=2, alias="DST")
    k: int = Field(default=0, ge=0, le=1, alias="K")

    # FLEX slots
    flex_slots: int = Field(default=1, ge=0, le=3)
    # How the flex demand is split across positions for baseline (should sum to 1)
    flex_rb: float = Field(default=0.5)
    flex_wr: float = Field(default=0.4)
    flex_te: float = Field(default=0.1)
    flex_qb: float = Field(default=0.0, description="Non-zero for superflex")

    # Auction mode
    auction_mode: bool = Field(default=False)
    auction_budget: int = Field(default=200, ge=50, le=1000)

    scoring: ScoringConfig = Field(default_factory=ScoringConfig)

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def validate_flex_alloc(self) -> "LeagueConfig":
        total = self.flex_rb + self.flex_wr + self.flex_te + self.flex_qb
        if abs(total - 1.0) > 0.01:
            raise ValueError(
                f"flex_rb + flex_wr + flex_te + flex_qb must sum to 1.0 (got {total:.3f})"
            )
        return self

    # ---------------------------------------------------------------------- #
    # Derived helpers
    # ---------------------------------------------------------------------- #

    @property
    def starters(self) -> dict[str, int]:
        return {"QB": self.qb, "RB": self.rb, "WR": self.wr, "TE": self.te, "DST": self.dst, "K": self.k}

    @property
    def flex_alloc(self) -> dict[str, float]:
        return {"QB": self.flex_qb, "RB": self.flex_rb, "WR": self.flex_wr, "TE": self.flex_te}

    @property
    def n_rostered(self) -> int:
        """Total roster spots across all teams (used for auction math)."""
        total_starters = self.qb + self.rb + self.wr + self.te + self.dst + self.k + self.flex_slots
        bench_spots = 6  # standard bench size assumption
        return (total_starters + bench_spots) * self.n_teams
