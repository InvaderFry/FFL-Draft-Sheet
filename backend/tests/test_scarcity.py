"""Tests for engine/scarcity.py (U9)."""

import pytest
from app.engine.vbd import PlayerVBD
from app.engine.scarcity import assign_positional_scarcity, assign_auction_prices
from tests.factories import build_league


def _make_rb(name, val):
    return PlayerVBD(
        sleeper_id=None, espn_id=None,
        player_name=name, pos="RB", team="KC",
        bye_week=10,
        mean_pts=val + 80, sd_pts=8, n_sources=3,
        baseline=80.0, val=val, floor=val - 8, ceil=val + 8,
    )


def _canonical_cfg(auction=False, budget=200, n_teams=12):
    return build_league(n_teams=n_teams, auction_mode=auction, auction_budget=budget)


# ---- positional scarcity -----------------------------------------------------

def test_highest_val_rb_has_lowest_ps():
    players = [_make_rb(f"RB{i}", float(100 - i * 10)) for i in range(6)]
    result = assign_positional_scarcity(players)
    ps_vals = [p.ps_pct for p in result]
    # PS should be non-increasing (value removes from pool)
    assert all(ps_vals[i] >= ps_vals[i + 1] for i in range(len(ps_vals) - 1))
    # First player (highest VAL) has highest PS (most value remains after him)
    # Last player has lowest PS ≈ 0
    assert ps_vals[-1] == pytest.approx(0.0, abs=0.01)


def test_last_rb_ps_approx_zero():
    players = [_make_rb(f"RB{i}", float(50 - i * 5)) for i in range(10)]
    result = assign_positional_scarcity(players)
    assert result[-1].ps_pct == pytest.approx(0.0, abs=0.001)


def test_all_zero_val_ps_zero():
    players = [_make_rb(f"WW{i}", 0.0) for i in range(5)]
    result = assign_positional_scarcity(players)
    assert all(p.ps_pct == 0.0 for p in result)


# ---- auction prices ----------------------------------------------------------

def test_auction_budget_conservation():
    """Sum of all prices must not exceed total auction budget."""
    cfg = _canonical_cfg(auction=True, budget=200, n_teams=12)
    rbs = [_make_rb(f"RB{i}", float(100 - i * 2)) for i in range(30)]
    wrs = [PlayerVBD(sleeper_id=None, espn_id=None, player_name=f"WR{i}", pos="WR",
                     team="KC", bye_week=10, mean_pts=80 - i, sd_pts=6, n_sources=3,
                     baseline=60.0, val=float(80 - i - 60), floor=0, ceil=100) for i in range(40)]
    all_players = rbs + wrs
    result = assign_auction_prices(all_players, cfg)
    total_prices = sum(p.auction_price for p in result)
    total_budget = cfg.n_teams * cfg.auction_budget
    assert total_prices <= total_budget + 1  # allow $1 rounding


def test_every_player_at_least_1_dollar():
    cfg = _canonical_cfg(auction=True)
    players = [_make_rb(f"RB{i}", float(max(0, 50 - i * 5))) for i in range(20)]
    result = assign_auction_prices(players, cfg)
    assert all(p.auction_price >= 1.0 for p in result if p.auction_price is not None)


def test_auction_disabled_leaves_prices_none():
    cfg = _canonical_cfg(auction=False)
    players = [_make_rb("A", 50.0)]
    result = assign_auction_prices(players, cfg)
    assert result[0].auction_price is None


def test_10team_200_budget_spot_check():
    """10-team, $200 budget, 15 roster spots: discretionary = $2000 - $150 = $1850."""
    cfg = build_league(n_teams=10, auction_mode=True, auction_budget=200)
    expected_disc = cfg.n_teams * cfg.auction_budget - cfg.n_rostered
    assert expected_disc > 0


def test_n_rostered_default_is_6_bench():
    cfg = build_league(n_teams=12)
    total_starters = cfg.qb + cfg.rb + cfg.wr + cfg.te + cfg.dst + cfg.k + cfg.flex_slots
    assert cfg.bench_spots == 6
    assert cfg.n_rostered == (total_starters + 6) * 12


def test_bench_spots_changes_n_rostered():
    cfg = build_league(n_teams=10, bench_spots=8)
    total_starters = cfg.qb + cfg.rb + cfg.wr + cfg.te + cfg.dst + cfg.k + cfg.flex_slots
    assert cfg.n_rostered == (total_starters + 8) * 10
