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

def test_qb_positive_players_have_7_or_fewer_tiers():
    players = _make_qbs([50 - i * 2 for i in range(40)])  # 40 QBs, mixed +/- vals
    result = assign_tiers(players)
    pos_tiers = {p.tier for p in result if p.val > 0}
    assert max(pos_tiers) <= 7  # positive players use at most k-1 tiers


def test_rb_positive_players_have_11_or_fewer_tiers():
    players = _make_rbs([80 - i for i in range(120)])  # vals 80 down to -39
    result = assign_tiers(players)
    pos_tiers = {p.tier for p in result if p.val > 0}
    assert max(pos_tiers) <= 11


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


def test_sub_baseline_players_tiered_below_positive():
    vals = [20, 15, 10, 5, 0, -2, -5, -8, -12]
    players = _make_qbs(vals)
    result = assign_tiers(players)
    sub_tiers = {p.tier for p in result if p.val <= 0}
    pos_tiers = {p.tier for p in result if p.val > 0}

    # Sub-baseline tiers continue contiguously after the last positive tier
    assert min(sub_tiers) == max(pos_tiers) + 1
    assert min(sub_tiers) > max(pos_tiers)
    assert len(pos_tiers) >= 2


def test_all_sub_baseline_pool_still_gets_tiered():
    players = _make_qbs([0, -2, -5, -8, -12])
    result = assign_tiers(players)

    tier_set = sorted({p.tier for p in result})
    # Tiers start at 1 and are contiguous
    assert tier_set == list(range(1, max(tier_set) + 1))
    # Lower val never gets a better (lower) tier number
    for a, b in zip(result, result[1:]):
        assert a.tier <= b.tier


def test_tier_is_even_flag():
    players = _make_qbs([50 - i * 4 for i in range(25)])  # includes negative vals
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


# ---- sub-baseline tiering ----------------------------------------------------

def test_tiers_contiguous_across_baseline_boundary():
    """Mixed positive/negative pool: tier numbers have no gap at the 0-VAL boundary."""
    players = _make_qbs([60 - i * 3 for i in range(40)])  # 60 down to -57
    result = assign_tiers(players)
    tier_set = sorted({p.tier for p in result})
    assert tier_set == list(range(1, max(tier_set) + 1))


def test_sub_baseline_split_into_multiple_tiers():
    """A long, clearly clustered negative tail should produce >= 2 sub tiers."""
    pos_vals = [50, 45, 30, 25, 12, 10, 4, 2]
    sub_vals = [-1, -2, -3, -4, -20, -22, -24, -26, -50, -52, -54, -56,
                -80, -82, -84, -86, -110, -112, -114, -116]
    players = _make_qbs(pos_vals + sub_vals)
    result = assign_tiers(players)
    sub_tiers = {p.tier for p in result if p.val <= 0}
    assert len(sub_tiers) >= 2


def test_dense_near_zero_cluster_still_splits():
    """The dense cluster just below baseline must split into multiple tiers
    even when a sparse deep tail follows (Jenks lumps the dense cluster into
    one giant tier; rank bands must not)."""
    pos_vals = [60, 50, 40, 30, 20, 10, 5, 2]
    dense = [-(0.1 * i) for i in range(1, 31)]       # 30 players, -0.1 .. -3.0
    sparse = [-50, -100, -150, -200, -250, -300]
    players = _make_qbs(pos_vals + dense + sparse)
    result = assign_tiers(players)
    dense_tiers = {p.tier for p in result if -3.5 <= p.val <= 0}
    assert len(dense_tiers) >= 3


def test_single_sub_baseline_player():
    players = _make_qbs([40, 30, 20, -5])
    result = assign_tiers(players)
    pos_tiers = {p.tier for p in result if p.val > 0}
    sub = [p for p in result if p.val <= 0]
    assert len(sub) == 1
    assert sub[0].tier == max(pos_tiers) + 1


def test_sub_tier_bands_are_even():
    """Tail tiers are equal-count bands; no tier swallows the whole tail."""
    players = _make_qbs([30, 20, 10] + [-float(i) for i in range(1, 201)])
    result = assign_tiers(players)
    sub = [p for p in result if p.val <= 0]
    from collections import Counter
    sizes = Counter(p.tier for p in sub)
    band_sizes = [sizes[t] for t in sorted(sizes)]
    # All distinct vals: every band except possibly the last has the same size
    assert len(set(band_sizes[:-1])) == 1
    assert max(band_sizes) <= band_sizes[0]


def test_ties_do_not_straddle_tier_boundary():
    """Players with equal val always share a tier, even at a band boundary."""
    # band size will be 3 (floor); the run of -5s crosses a boundary
    players = _make_qbs([40, 30, 20, -1, -2, -5, -5, -5, -5, -9, -10, -11])
    result = assign_tiers(players)
    tied = {p.tier for p in result if p.val == -5}
    assert len(tied) == 1


def test_tier_monotonic_in_val():
    """Across the whole list (sorted desc by val), tier numbers never decrease."""
    players = _make_qbs([55 - i * 2.5 for i in range(50)])
    result = assign_tiers(players)
    for a, b in zip(result, result[1:]):
        assert a.tier <= b.tier


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
    """Positive players get contiguous tiers; sub-baseline tiers continue after them."""
    vals = [40, 30, 20, 0, -5, -5]
    players = _make_qbs(vals)
    result = assign_tiers(players)

    by_val = {p.val: p.tier for p in result}
    assert by_val[40] == 1
    assert by_val[30] == 2
    assert by_val[20] == 3
    assert by_val[0] == 4          # first sub tier = last positive tier + 1
    assert by_val[-5] >= by_val[0]

    pos_tier_set = sorted({p.tier for p in result if p.val > 0})
    assert pos_tier_set == list(range(1, max(pos_tier_set) + 1))


# ---- multi-method tiers (GMM) ------------------------------------------------

def test_all_methods_populate_tiers_dict():
    players = _make_rbs([80 - i for i in range(120)])
    result = assign_tiers(players)
    for p in result:
        assert "jenks" in p.tiers
        assert "gmm" in p.tiers
        # The flat field mirrors the default (jenks) method for back-compat.
        assert p.tier == p.tiers["jenks"]
        assert p.tier_is_even == (p.tier % 2 == 0)


def test_gmm_tiers_monotonic_in_val():
    players = _make_qbs([55 - i * 2.5 for i in range(50)])
    result = assign_tiers(players)
    for a, b in zip(result, result[1:]):
        assert a.tiers["gmm"] <= b.tiers["gmm"]


def test_gmm_tier1_contains_highest_val():
    players = _make_rbs([100 - i * 2 for i in range(40)])
    result = assign_tiers(players)
    t1 = [p.val for p in result if p.tiers["gmm"] == 1]
    rest = [p.val for p in result if p.tiers["gmm"] > 1]
    assert t1 and rest
    assert min(t1) >= max(rest)


def test_gmm_produces_multiple_tiers_on_clustered_data():
    vals = [100, 99, 98, 60, 59, 58, 20, 19, 18] + [40 - i for i in range(30)]
    players = _make_rbs(vals)
    result = assign_tiers(players)
    assert len({p.tiers["gmm"] for p in result if p.val > 0}) >= 2


def test_gmm_degenerate_all_same_val():
    players = _make_qbs([30.0] * 20)
    result = assign_tiers(players)
    assert len({p.tiers["gmm"] for p in result}) == 1


def test_gmm_falls_back_to_jenks_on_failure(monkeypatch, caplog):
    def boom(_values, _n):
        raise RuntimeError("singular covariance")

    monkeypatch.setattr(tiers_mod, "_gmm_breaks_impl", boom)
    players = _make_rbs([80 - i for i in range(60)])
    with caplog.at_level("WARNING"):
        result = assign_tiers(players)
    # GMM still assigned (via Jenks fallback), monotonic, no crash.
    for a, b in zip(result, result[1:]):
        assert a.tiers["gmm"] <= b.tiers["gmm"]
    assert any("falling back to Jenks" in r.message for r in caplog.records)


def test_jenks_runtime_failure_falls_back_loudly(monkeypatch, caplog):
    def fail_jenks_breaks(_values, n_classes):
        raise RuntimeError("bad input")

    monkeypatch.setattr(tiers_mod.jenkspy, "jenks_breaks", fail_jenks_breaks)
    values = [float(i) for i in range(10)]

    with caplog.at_level("ERROR"):
        breaks = _jenks_breaks(values, n_classes=4)

    assert breaks == pytest.approx([0.0, 2.25, 4.5, 6.75, 9.0])
    assert any("tier quality degraded" in record.message for record in caplog.records)
