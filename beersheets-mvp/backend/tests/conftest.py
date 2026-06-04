"""Shared pytest fixtures."""

import pytest

from app.config import LeagueConfig


@pytest.fixture
def make_league():
    """
    Factory for a valid LeagueConfig with canonical defaults
    (12-team, 1QB/2RB/3WR/1TE/1DST/0K, 1 FLEX).  Pass keyword overrides for any
    field, e.g. make_league(season=2027) or make_league(n_teams=10).
    """
    def _make(**overrides):
        params = dict(QB=1, RB=2, WR=3, TE=1, DST=1, K=0, flex_slots=1)
        params.update(overrides)
        return LeagueConfig(**params)

    return _make
