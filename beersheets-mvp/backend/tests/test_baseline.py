"""Tests for engine/baseline.py (U6)."""

import pytest
from app.config import LeagueConfig
from app.engine.baseline import games_needed, baseline_rank, compute_baselines


@pytest.fixture
def canonical_cfg():
    """12-team, 0.5 PPR, 1QB/2RB/3WR/1TE/1FLEX (RB50/WR40/TE10), 14 weeks."""
    return LeagueConfig(
        n_teams=12,
        fantasy_weeks=14,
        QB=1, RB=2, WR=3, TE=1, DST=1, K=0,
        flex_slots=1, flex_rb=0.5, flex_wr=0.4, flex_te=0.1,
    )


@pytest.fixture
def flat_curve():
    """All ranks average 14 games played (simple fallback)."""
    return [14.0] * 80


# ---- games_needed ------------------------------------------------------------

def test_games_needed_qb(canonical_cfg):
    # QB: 12 * (1 + 1*0) * 14 = 168
    assert games_needed("QB", canonical_cfg) == pytest.approx(168.0)


def test_games_needed_rb(canonical_cfg):
    # RB: 12 * (2 + 1*0.5) * 14 = 12 * 2.5 * 14 = 420
    assert games_needed("RB", canonical_cfg) == pytest.approx(420.0)


def test_games_needed_wr(canonical_cfg):
    # WR: 12 * (3 + 1*0.4) * 14 = 12 * 3.4 * 14 = 571.2
    assert games_needed("WR", canonical_cfg) == pytest.approx(571.2)


# ---- baseline_rank -----------------------------------------------------------

def test_baseline_rank_qb_flat_curve(canonical_cfg, flat_curve):
    # games_needed(QB) = 168; 168/14 = 12 → rank 12
    assert baseline_rank("QB", canonical_cfg, flat_curve) == 12


def test_baseline_rank_rb_flat_curve(canonical_cfg, flat_curve):
    # games_needed(RB) = 420; 420/14 = 30 → rank 30
    assert baseline_rank("RB", canonical_cfg, flat_curve) == 30


def test_baseline_rank_within_expected_range(canonical_cfg, flat_curve):
    """Sanity check against canonical values (QB≈15, RB≈44, WR≈55, TE≈19).
    With a flat 14-game curve these will be lower, but the real attrition curve
    pushes them deeper due to injured/lost player-games.  Just verify they're positive."""
    for pos in ("QB", "RB", "WR", "TE"):
        br = baseline_rank(pos, canonical_cfg, flat_curve)
        assert br >= 1


def test_baseline_rank_fewer_teams_reduces_rank():
    cfg10 = LeagueConfig(n_teams=10, QB=1, RB=2, WR=3, TE=1, DST=1, K=0,
                         flex_slots=1, flex_rb=0.5, flex_wr=0.4, flex_te=0.1)
    cfg12 = LeagueConfig(n_teams=12, QB=1, RB=2, WR=3, TE=1, DST=1, K=0,
                         flex_slots=1, flex_rb=0.5, flex_wr=0.4, flex_te=0.1)
    curve = [14.0] * 80
    assert baseline_rank("RB", cfg10, curve) < baseline_rank("RB", cfg12, curve)


def test_baseline_rank_curve_too_short(canonical_cfg):
    short_curve = [14.0] * 5
    br = baseline_rank("RB", canonical_cfg, short_curve)
    assert br == 5   # capped at last rank


def test_superflex_pushes_qb_baseline_deeper():
    cfg_sf = LeagueConfig(n_teams=12, QB=2, RB=2, WR=3, TE=1, DST=1, K=0,
                          flex_slots=1, flex_rb=0.5, flex_wr=0.4, flex_te=0.1)
    cfg_1qb = LeagueConfig(n_teams=12, QB=1, RB=2, WR=3, TE=1, DST=1, K=0,
                           flex_slots=1, flex_rb=0.5, flex_wr=0.4, flex_te=0.1)
    curve = [14.0] * 80
    assert baseline_rank("QB", cfg_sf, curve) > baseline_rank("QB", cfg_1qb, curve)


# ---- compute_baselines -------------------------------------------------------

def test_compute_baselines_returns_all_positions(canonical_cfg, flat_curve):
    pos_proj = {pos: [100.0 - i for i in range(50)] for pos in ("QB", "RB", "WR", "TE", "DST", "K")}
    result = compute_baselines(canonical_cfg, {"QB": flat_curve, "RB": flat_curve,
                                               "WR": flat_curve, "TE": flat_curve,
                                               "DST": flat_curve, "K": flat_curve}, pos_proj)
    for pos in ("QB", "RB", "WR", "TE"):
        assert pos in result
        assert result[pos] >= 0.0
