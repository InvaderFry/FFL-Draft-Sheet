"""Shared test object factories."""

from app.config import LeagueConfig


def build_league(**overrides) -> LeagueConfig:
    """
    Build a valid LeagueConfig with canonical defaults (12-team, 0.5 PPR,
    1QB/2RB/3WR/1TE/1DST/0K, 1 FLEX with RB50/WR40/TE10, 14 weeks).  Pass keyword
    overrides for any field, e.g. build_league(season=2027) or
    build_league(n_teams=10, auction_mode=True).
    """
    params = dict(QB=1, RB=2, WR=3, TE=1, DST=1, K=0, flex_slots=1)
    params.update(overrides)
    return LeagueConfig(**params)
