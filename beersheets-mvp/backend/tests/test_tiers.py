"""Tests for engine/tiers.py (U8)."""

import pytest
from app.engine.vbd import PlayerVBD
from app.engine.tiers import assign_tiers


def _make_player(name, pos, val):
    return PlayerVBD(
        sleeper_id=None, espn_id=None,
        player_name=name, pos=pos, team="KC",
        bye_week=10,
        mean_pts=val + 100, sd_pts=10, n_sources=3,
        baseline=100.0, val=val, floor=val - 10, ceil=val + 10,
    )


def _make_qbs(vals):
    return [_make_player(f"QB{i}", "QB", v) for i, v in enumerate(vals)]


def _make_rbs(vals):
    return [_make_player(f"RB{i}", "RB", v) for i, v in enumerate(vals)]


# ---- basic functionality -----------------------------------------------------

def test_qb_has_8_or_fewer_tiers():
    players = _make_qbs([50 - i * 2 for i in range(40)])  # 40 QBs
    result = assign_tiers(players)
    tiers = {p.tier for p in result}
    assert max(tiers) <= 8


def test_rb_has_12_or_fewer_tiers():
    players = _make_rbs([80 - i for i in range(60)])
    result = assign_tiers(players)
    tiers = {p.tier for p in result}
    assert max(tiers) <= 12


def test_tier_1_contains_highest_val_players():
    players = _make_qbs([50, 45, 40, 20, 10, 5, 2, 1, 0, 0])
    result = assign_tiers(players)
    # Tier 1 players should have higher VAL than tier 2+ players
    tier1_vals = [p.val for p in result if p.tier == 1]
    tier2plus_vals = [p.val for p in result if p.tier > 1]
    if tier1_vals and tier2plus_vals:
        assert min(tier1_vals) >= max(tier2plus_vals)


def test_tiers_are_contiguous():
    """No tier number should be skipped in the output."""
    players = _make_qbs([50 - i * 2 for i in range(30)])
    result = assign_tiers(players)
    tier_set = sorted({p.tier for p in result})
    # Should be 1,2,3,... with no gaps
    assert tier_set == list(range(1, max(tier_set) + 1))


def test_degenerate_all_same_val():
    players = _make_qbs([30.0] * 20)
    result = assign_tiers(players)
    # All players should land in the same tier
    tiers = {p.tier for p in result}
    assert len(tiers) == 1


def test_sub_baseline_players_last_tier():
    vals = [50, 40, 30, 20, 10, 0, 0, 0]
    players = _make_qbs(vals)
    result = assign_tiers(players)
    max_tier = max(p.tier for p in result)
    zero_tiers = {p.tier for p in result if p.val == 0}
    assert all(t == max_tier for t in zero_tiers)


def test_tier_is_even_flag():
    players = _make_qbs([50 - i * 2 for i in range(20)])
    result = assign_tiers(players)
    for p in result:
        assert p.tier_is_even == (p.tier % 2 == 0)


def test_mutates_in_place():
    players = _make_qbs([50, 40, 30])
    original_ids = [id(p) for p in players]
    result = assign_tiers(players)
    assert [id(p) for p in result] == original_ids


def test_empty_list():
    assert assign_tiers([]) == []
