"""Tests for data/variance.py weekly outcome CV loader."""

import sys
from types import SimpleNamespace

import pandas as pd
import pytest

from app import cache
from app.data.variance import CV_CLAMP, MIN_GAMES, load_variance


@pytest.fixture
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)


def test_load_variance_builds_player_cv_pos_median_and_cache(isolated_cache, monkeypatch):
    calls = {"count": 0}

    def fake_import_weekly_data(seasons):
        calls["count"] += 1
        assert seasons == [2023, 2024, 2025]
        return pd.DataFrame({
            "player_id": ["rb_good"] * MIN_GAMES + ["rb_low"] * MIN_GAMES + ["wr_clamp"] * MIN_GAMES,
            "position": ["RB"] * (MIN_GAMES * 2) + ["WR"] * MIN_GAMES,
            "fantasy_points_ppr": (
                [10, 11, 9, 10, 12, 8, 10, 10]
                + [20, 20, 20, 20, 20, 20, 20, 21]
                + [1, 30, 1, 30, 1, 30, 1, 30]
            ),
            "season_type": ["REG"] * (MIN_GAMES * 3),
        })

    monkeypatch.setitem(sys.modules, "nfl_data_py", SimpleNamespace(import_weekly_data=fake_import_weekly_data))

    variance = load_variance(2026, force_refresh=True)
    assert calls["count"] == 1

    assert variance["available"] is True
    assert set(variance["player_cv"]) == {"rb_good", "rb_low", "wr_clamp"}
    assert variance["player_cv"]["rb_low"] == pytest.approx(CV_CLAMP[0])
    assert variance["player_cv"]["wr_clamp"] == pytest.approx(CV_CLAMP[1])
    assert variance["pos_median_cv"]["RB"] == pytest.approx(
        (variance["player_cv"]["rb_good"] + variance["player_cv"]["rb_low"]) / 2
    )
    assert variance["pos_median_cv"]["DST"] == pytest.approx(0.45)

    cached = load_variance(2026)
    assert calls["count"] == 1
    assert cached == variance


def test_load_variance_excludes_low_sample_players(isolated_cache, monkeypatch):
    def fake_import_weekly_data(_seasons):
        return pd.DataFrame({
            "gsis_id": ["small"] * (MIN_GAMES - 1) + ["enough"] * MIN_GAMES,
            "position": ["QB"] * ((MIN_GAMES - 1) + MIN_GAMES),
            "fantasy_points": [10.0] * (MIN_GAMES - 1) + [10, 12, 8, 11, 9, 10, 13, 7],
        })

    monkeypatch.setitem(sys.modules, "nfl_data_py", SimpleNamespace(import_weekly_data=fake_import_weekly_data))

    variance = load_variance(2026, force_refresh=True)
    assert variance["available"] is True
    assert "small" not in variance["player_cv"]
    assert "enough" in variance["player_cv"]


def test_load_variance_loader_failure_returns_fallback(isolated_cache, monkeypatch):
    def fake_import_weekly_data(_seasons):
        raise RuntimeError("network down")

    monkeypatch.setitem(sys.modules, "nfl_data_py", SimpleNamespace(import_weekly_data=fake_import_weekly_data))

    variance = load_variance(2026, force_refresh=True)
    assert variance["available"] is False
    assert variance["player_cv"] == {}
    assert variance["pos_median_cv"]["RB"] == pytest.approx(0.45)
