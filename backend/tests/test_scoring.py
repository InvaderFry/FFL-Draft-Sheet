"""Tests for engine/scoring.py (U4)."""

import pytest
from app.config import ScoringConfig
from app.engine.scoring import score, _dst_pa_points


# ---- fixtures ----------------------------------------------------------------

@pytest.fixture
def standard_cfg():
    return ScoringConfig(rec=0.0)   # standard (non-PPR)

@pytest.fixture
def half_ppr_cfg():
    return ScoringConfig(rec=0.5)   # half PPR

@pytest.fixture
def full_ppr_cfg():
    return ScoringConfig(rec=1.0)   # full PPR


# ---- QB scoring --------------------------------------------------------------

def test_qb_standard(standard_cfg):
    stats = {"pass_yds": 300, "pass_td": 3, "interception": 1}
    pts = score(stats, standard_cfg)
    # 300*0.04 + 3*4 + 1*(-2) = 12 + 12 - 2 = 22.0
    assert pts == pytest.approx(22.0)


def test_qb_with_rushing(standard_cfg):
    stats = {"pass_yds": 250, "pass_td": 2, "rush_yds": 40, "rush_td": 1}
    pts = score(stats, standard_cfg)
    # 10 + 8 + 4 + 6 = 28
    assert pts == pytest.approx(28.0)


# ---- RB scoring --------------------------------------------------------------

def test_rb_half_ppr(half_ppr_cfg):
    stats = {"rush_yds": 80, "rush_td": 1, "rec": 5, "rec_yds": 30}
    pts = score(stats, half_ppr_cfg)
    # 80*0.1 + 6 + 5*0.5 + 30*0.1 = 8 + 6 + 2.5 + 3 = 19.5
    assert pts == pytest.approx(19.5)


def test_rb_full_ppr_with_receiving_td(full_ppr_cfg):
    stats = {"rush_yds": 80, "rush_td": 1, "rec": 5, "rec_yds": 30, "rec_td": 1}
    pts = score(stats, full_ppr_cfg)
    # 8 + 6 + 5 + 3 + 6 = 28
    assert pts == pytest.approx(28.0)


# ---- TE premium --------------------------------------------------------------

def test_te_premium(half_ppr_cfg):
    cfg = ScoringConfig(rec=0.5, te_premium=0.5)
    stats = {"rec": 7, "rec_yds": 65, "rec_td": 1, "te_premium_eligible": True}
    pts = score(stats, cfg)
    # 7*(0.5+0.5) + 65*0.1 + 6 = 7 + 6.5 + 6 = 19.5
    assert pts == pytest.approx(19.5)


def test_te_premium_not_applied_when_not_eligible(half_ppr_cfg):
    cfg = ScoringConfig(rec=0.5, te_premium=0.5)
    stats = {"rec": 7, "rec_yds": 65, "rec_td": 1}  # no te_premium_eligible key
    pts = score(stats, cfg)
    # 7*0.5 + 65*0.1 + 6 = 3.5 + 6.5 + 6 = 16
    assert pts == pytest.approx(16.0)


# ---- DST scoring -------------------------------------------------------------

def test_dst_pa_brackets():
    cfg = ScoringConfig()
    assert _dst_pa_points(0, cfg) == pytest.approx(10.0)
    assert _dst_pa_points(3, cfg) == pytest.approx(7.0)
    assert _dst_pa_points(10, cfg) == pytest.approx(4.0)
    assert _dst_pa_points(17, cfg) == pytest.approx(1.0)
    assert _dst_pa_points(24, cfg) == pytest.approx(0.0)
    assert _dst_pa_points(30, cfg) == pytest.approx(-1.0)
    assert _dst_pa_points(40, cfg) == pytest.approx(-4.0)


def test_dst_full(standard_cfg):
    stats = {"dst_sack": 3, "dst_int": 2, "dst_td": 1, "dst_pa": 10}
    pts = score(stats, standard_cfg)
    # 3*1 + 2*2 + 1*6 + 4 (PA 7-13) = 3 + 4 + 6 + 4 = 17
    assert pts == pytest.approx(17.0)


# ---- Edge cases --------------------------------------------------------------

def test_unknown_stat_key_ignored(half_ppr_cfg):
    stats = {"rush_yds": 100, "rush_td": 1, "made_up_stat": 9999}
    pts = score(stats, half_ppr_cfg)
    assert pts == pytest.approx(10 + 6)   # only rush_yds and rush_td count


def test_empty_stats(half_ppr_cfg):
    assert score({}, half_ppr_cfg) == pytest.approx(0.0)


def test_fumble_lost_penalty(half_ppr_cfg):
    stats = {"rush_yds": 100, "fumble_lost": 2}
    pts = score(stats, half_ppr_cfg)
    assert pts == pytest.approx(10 + 2 * -2.0)   # 10 - 4 = 6


def test_score_is_pure_no_side_effects(half_ppr_cfg):
    """score() must not modify its inputs."""
    stats = {"rush_yds": 100, "rush_td": 1}
    original = dict(stats)
    score(stats, half_ppr_cfg)
    assert stats == original
