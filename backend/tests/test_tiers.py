"""Tests for engine/tiers.py (U8)."""

import pytest
from app.engine.vbd import PlayerVBD
from app.engine import tiers as tiers_mod
from app.engine.tiers import _jenks_breaks, assign_tiers


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


def test_sub_baseline_players_land_on_last_tier():
    vals = [20, 15, 10, 5, 0, -2, -5, -8, -12]
    players = _make_qbs(vals)
    result = assign_tiers(players)
    sub_tiers = {p.tier for p in result if p.val <= 0}
    pos_tiers = {p.tier for p in result if p.val > 0}

    assert sub_tiers == {8}
    assert all(t < 8 for t in pos_tiers)
    assert len(pos_tiers) >= 2


def test_all_sub_baseline_players_land_on_last_tier():
    players = _make_qbs([0, -2, -5, -8, -12])
    result = assign_tiers(players)

    assert {p.tier for p in result} == {8}


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


# ---- degenerate: fewer distinct values than tier count -----------------------

def test_few_distinct_values_each_get_own_contiguous_tier():
    """With fewer distinct positive VALs than the tier cap, each distinct value
    should map to its own contiguous tier (1=highest), with no skipped numbers."""
    # 5 distinct positive values, many duplicate players, QB cap = 8
    vals = [50, 50, 40, 40, 30, 20, 10, 10]
    players = _make_qbs(vals)
    result = assign_tiers(players)

    tier_set = sorted({p.tier for p in result})
    assert tier_set == [1, 2, 3, 4, 5]          # contiguous, exactly 5 distinct
    # Highest value is tier 1, lowest positive is the last tier
    by_val = {p.val: p.tier for p in result}
    assert by_val[50] == 1
    assert by_val[40] == 2
    assert by_val[30] == 3
    assert by_val[20] == 4
    assert by_val[10] == 5
    # Equal values share a tier
    fifties = [p.tier for p in result if p.val == 50]
    assert len(set(fifties)) == 1


def test_few_distinct_values_with_sub_baseline():
    """Sub-baseline players land on tier k; positive players get contiguous tiers."""
    vals = [40, 30, 20, 0, -5, -5]
    players = _make_qbs(vals)
    result = assign_tiers(players)

    by_val = {p.val: p.tier for p in result}
    assert by_val[40] == 1
    assert by_val[30] == 2
    assert by_val[20] == 3
    assert by_val[0] == 8
    assert by_val[-5] == 8

    pos_tier_set = sorted({p.tier for p in result if p.val > 0})
    assert pos_tier_set == list(range(1, max(pos_tier_set) + 1))


def test_jenks_runtime_failure_falls_back_loudly(monkeypatch, caplog):
    def fail_jenks_breaks(_values, n_classes):
        raise RuntimeError("bad input")

    monkeypatch.setattr(tiers_mod.jenkspy, "jenks_breaks", fail_jenks_breaks)
    values = [float(i) for i in range(10)]

    with caplog.at_level("ERROR"):
        breaks = _jenks_breaks(values, n_classes=4)

    assert breaks == pytest.approx([0.0, 2.25, 4.5, 6.75, 9.0])
    assert any("tier quality degraded" in record.message for record in caplog.records)
