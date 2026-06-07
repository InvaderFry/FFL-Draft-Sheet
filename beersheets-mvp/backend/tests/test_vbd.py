"""Tests for engine/vbd.py (U7)."""

from types import SimpleNamespace

import pytest
from app.engine.vbd import aggregate_projections, SD_FALLBACK_RATIO
from app.config import ScoringConfig


def _make_row(player_name, team, pts, source, sleeper_id=None, pos="RB"):
    return {
        "source": source,
        "player_name": player_name,
        "pos": pos,
        "team": team,
        "sleeper_id": sleeper_id,
        "points": pts,
    }


# ---- multi-source aggregation -----------------------------------------------

def test_mean_and_sd_three_sources():
    rows = [
        _make_row("CMC", "SF", 300.0, "ESPN", "cmc_id"),
        _make_row("CMC", "SF", 320.0, "FP",   "cmc_id"),
        _make_row("CMC", "SF", 280.0, "FFT",  "cmc_id"),
    ]
    players = aggregate_projections(rows, "RB", baseline=100.0)
    assert len(players) == 1
    p = players[0]
    assert p.mean_pts == pytest.approx(300.0)
    assert p.n_sources == 3
    assert p.sd_pts > 0


def test_val_floor_ceil_source_sigma_fallback_when_variance_none():
    rows = [
        _make_row("PlayerA", "KC", 200.0, "ESPN", "a_id"),
        _make_row("PlayerA", "KC", 220.0, "FP",   "a_id"),
    ]
    players = aggregate_projections(rows, "QB", baseline=150.0)
    p = players[0]
    mean = 210.0
    import numpy as np
    sd = float(np.std([200.0, 220.0], ddof=1))
    assert p.val == pytest.approx(mean - 150.0)
    assert p.floor == pytest.approx((mean - sd) - 150.0)
    assert p.ceil == pytest.approx((mean + sd) - 150.0)


def test_floor_ceil_from_player_cv():
    rows = [
        _make_row("Boom RB", "KC", 200.0, "ESPN", "boom_id"),
        _make_row("Boom RB", "KC", 220.0, "FP", "boom_id"),
    ]
    player_map = {"boom_id": SimpleNamespace(bye_week=8, gsis_id="gsis_boom")}
    variance = {
        "player_cv": {"gsis_boom": 0.30},
        "pos_median_cv": {"RB": 0.45},
    }

    p = aggregate_projections(rows, "RB", baseline=100.0, player_info_map=player_map, variance=variance)[0]

    mean = 210.0
    band = 0.30 * mean
    assert p.gsis_id == "gsis_boom"
    assert p.bye_week == 8
    assert p.val == pytest.approx(mean - 100.0)
    assert p.floor == pytest.approx((mean - band) - 100.0)
    assert p.ceil == pytest.approx((mean + band) - 100.0)


def test_floor_ceil_falls_back_to_pos_median_cv():
    rows = [_make_row("Rookie WR", "KC", 100.0, "ESPN", "rookie_id")]
    player_map = {"rookie_id": SimpleNamespace(bye_week=6, gsis_id="rookie_gsis")}
    variance = {
        "player_cv": {},
        "pos_median_cv": {"WR": 0.50},
    }

    p = aggregate_projections(rows, "WR", baseline=40.0, player_info_map=player_map, variance=variance)[0]

    assert p.floor == pytest.approx((100.0 - 50.0) - 40.0)
    assert p.ceil == pytest.approx((100.0 + 50.0) - 40.0)


def test_floor_ceil_no_gsis_uses_source_sigma_with_variance_loaded():
    rows = [_make_row("Unresolved TE", "FA", 180.0, "ESPN", "unresolved_id", pos="TE")]
    player_map = {"unresolved_id": SimpleNamespace(bye_week=None, gsis_id=None)}
    variance = {
        "player_cv": {},
        "pos_median_cv": {"TE": 0.45},
    }

    p = aggregate_projections(rows, "TE", baseline=100.0, player_info_map=player_map, variance=variance)[0]

    band = SD_FALLBACK_RATIO * 180.0
    assert p.gsis_id is None
    assert p.floor == pytest.approx((180.0 - band) - 100.0)
    assert p.ceil == pytest.approx((180.0 + band) - 100.0)


def test_floor_ceil_variance_unavailable_uses_source_sigma():
    rows = [_make_row("Any WR", "KC", 100.0, "ESPN", "wr_id")]
    player_map = {"wr_id": SimpleNamespace(bye_week=6, gsis_id="wr_gsis")}
    variance = {
        "available": False,
        "player_cv": {},
        "pos_median_cv": {"WR": 0.45},
    }

    p = aggregate_projections(rows, "WR", baseline=40.0, player_info_map=player_map, variance=variance)[0]

    band = SD_FALLBACK_RATIO * 100.0
    assert p.floor == pytest.approx((100.0 - band) - 40.0)
    assert p.ceil == pytest.approx((100.0 + band) - 40.0)


def test_single_source_sd_fallback():
    rows = [_make_row("LonePlayer", "DAL", 180.0, "ESPN", "lp_id")]
    players = aggregate_projections(rows, "WR", baseline=50.0)
    p = players[0]
    assert p.n_sources == 1
    assert p.sd_pts == pytest.approx(SD_FALLBACK_RATIO * 180.0)


def test_single_source_negative_mean_sd_fallback_is_nonnegative():
    rows = [_make_row("Bad DST", "CAR", -2.0, "ESPN", "dst_id", pos="DST")]
    p = aggregate_projections(rows, "DST", baseline=0.0, variance=None)[0]

    assert p.sd_pts == pytest.approx(SD_FALLBACK_RATIO * 2.0)
    assert p.floor < p.ceil


def test_sub_baseline_val_is_negative():
    rows = [_make_row("WaiverWire", "BUF", 10.0, "ESPN", "ww_id")]
    players = aggregate_projections(rows, "RB", baseline=100.0)
    p = players[0]
    assert p.val < 0
    assert p.floor < p.val


def test_sorted_descending_by_val():
    rows = [
        _make_row("Good", "KC", 300.0, "ESPN", "g_id"),
        _make_row("Great", "SF", 400.0, "ESPN", "gr_id"),
        _make_row("Meh",  "LV", 150.0, "ESPN", "m_id"),
    ]
    players = aggregate_projections(rows, "RB", baseline=50.0)
    vals = [p.val for p in players]
    assert vals == sorted(vals, reverse=True)


def test_pos_rank_assigned():
    rows = [_make_row(f"P{i}", "KC", float(100 - i * 10), "ESPN", f"p{i}_id") for i in range(5)]
    players = aggregate_projections(rows, "WR", baseline=0.0)
    assert [p.pos_rank for p in players] == [1, 2, 3, 4, 5]


def test_multiple_players_grouped_by_sleeper_id():
    rows = [
        _make_row("Justin Jefferson", "MIN", 380.0, "ESPN", "jj_id"),
        _make_row("Justin Jefferson", "MIN", 360.0, "FP",   "jj_id"),
        _make_row("Tyreek Hill",      "MIA", 320.0, "ESPN", "th_id"),
    ]
    players = aggregate_projections(rows, "WR", baseline=100.0)
    assert len(players) == 2


def test_empty_rows_returns_empty():
    assert aggregate_projections([], "QB", baseline=100.0) == []
