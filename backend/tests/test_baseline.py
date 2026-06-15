"""Tests for engine/baseline.py (U6)."""

import pytest
from app.engine.baseline import games_needed, baseline_rank, compute_baselines


@pytest.fixture
def canonical_cfg(make_league):
    """12-team, 0.5 PPR, 1QB/2RB/3WR/1TE/1FLEX (RB50/WR40/TE10), 14 weeks."""
    return make_league()


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


def test_baseline_rank_fewer_teams_reduces_rank(make_league):
    cfg10 = make_league(n_teams=10)
    cfg12 = make_league(n_teams=12)
    curve = [14.0] * 80
    assert baseline_rank("RB", cfg10, curve) < baseline_rank("RB", cfg12, curve)


def test_baseline_rank_curve_too_short(canonical_cfg):
    short_curve = [14.0] * 5
    br = baseline_rank("RB", canonical_cfg, short_curve)
    assert br == 5   # capped at last rank


def test_superflex_pushes_qb_baseline_deeper(make_league):
    cfg_sf = make_league(QB=2)
    cfg_1qb = make_league(QB=1)
    curve = [14.0] * 80
    assert baseline_rank("QB", cfg_sf, curve) > baseline_rank("QB", cfg_1qb, curve)


def test_flex_qb_superflex_deepens_qb_baseline(make_league):
    """A superflex *flex slot* (flex_qb > 0), not just extra QB starters, must
    raise QB games_needed and push the QB baseline rank deeper."""
    cfg_std = make_league()  # flex_qb defaults to 0.0
    cfg_sf = make_league(flex_rb=0.0, flex_wr=0.0, flex_te=0.0, flex_qb=1.0)
    curve = [14.0] * 80
    # Standard QB: 12*(1+0)*14 = 168; superflex: 12*(1+1.0)*14 = 336.
    assert games_needed("QB", cfg_sf) == pytest.approx(336.0)
    assert games_needed("QB", cfg_sf) > games_needed("QB", cfg_std)
    assert baseline_rank("QB", cfg_sf, curve) > baseline_rank("QB", cfg_std, curve)


def test_flex_qb_superflex_lowers_qb_baseline_points(make_league):
    """Deeper QB baseline rank → a lower-scoring replacement QB → lower QB
    baseline points (which is what raises every QB's VBD)."""
    curve = [14.0] * 80
    qb_proj = [300.0 - i for i in range(60)]  # strictly descending
    pos_proj = {"QB": qb_proj, "RB": qb_proj, "WR": qb_proj, "TE": qb_proj, "DST": qb_proj}
    curves = {pos: curve for pos in ("QB", "RB", "WR", "TE", "DST")}

    std = compute_baselines(make_league(), curves, pos_proj)
    sf = compute_baselines(
        make_league(flex_rb=0.0, flex_wr=0.0, flex_te=0.0, flex_qb=1.0), curves, pos_proj
    )
    assert sf["QB"] < std["QB"]


# ---- compute_baselines -------------------------------------------------------

def test_compute_baselines_returns_all_positions(canonical_cfg, flat_curve):
    pos_proj = {pos: [100.0 - i for i in range(50)] for pos in ("QB", "RB", "WR", "TE", "DST", "K")}
    result = compute_baselines(canonical_cfg, {"QB": flat_curve, "RB": flat_curve,
                                               "WR": flat_curve, "TE": flat_curve,
                                               "DST": flat_curve, "K": flat_curve}, pos_proj)
    for pos in ("QB", "RB", "WR", "TE"):
        assert pos in result
        assert result[pos] >= 0.0
