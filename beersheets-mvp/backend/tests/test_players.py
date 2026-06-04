"""Tests for data/players.py identity matching (U2)."""

import pytest

from app.data import players as players_mod
from app.data.players import PlayerRecord, find_player


def _rec(sid, full_name, pos, team):
    return PlayerRecord(
        sleeper_id=sid,
        first_name=full_name.split(" ")[0],
        last_name=full_name.split(" ")[-1],
        full_name=full_name,
        position=pos,
        team=team,
        bye_week=10,
        espn_id=f"espn_{sid}",
    )


@pytest.fixture
def seeded_map(monkeypatch):
    """Seed the module-level caches so find_player runs without any network call."""
    records = {
        "1": _rec("1", "Patrick Mahomes", "QB", "KC"),
        "2": _rec("2", "Justin Jefferson", "WR", "MIN"),
        "3": _rec("3", "Justin Fields", "QB", "CHI"),  # shares first name w/ #2
        "4": _rec("4", "Tyreek Hill", "WR", "MIA"),
    }
    monkeypatch.setattr(players_mod, "_player_map", records)
    monkeypatch.setattr(players_mod, "_name_index", players_mod._build_name_index(records))
    monkeypatch.setattr(players_mod, "_pos_index", players_mod._build_pos_index(records))
    return records


def test_exact_name_and_position_match(seeded_map):
    rec = find_player("Patrick Mahomes", "QB", "KC")
    assert rec is not None
    assert rec.sleeper_id == "1"


def test_fuzzy_match_only_within_position(seeded_map):
    # A slightly misspelled WR name must not match a same-first-name QB.
    rec = find_player("Justin Jeferson", "WR", "MIN")
    assert rec is not None
    assert rec.position == "WR"
    assert rec.sleeper_id == "2"


def test_pos_index_limits_candidate_scan(seeded_map):
    # The position index should only hold same-position candidates.
    assert {r.sleeper_id for r in players_mod._pos_index["QB"]} == {"1", "3"}
    assert {r.sleeper_id for r in players_mod._pos_index["WR"]} == {"2", "4"}


def test_cross_position_falls_back_to_full_scan(monkeypatch):
    """A source may classify a multi-position player differently than Sleeper.
    The same-position pass misses them, so find_player must fall back to the
    full map and still return the record."""
    records = {
        "10": _rec("10", "Taysom Hill", "TE", "NO"),   # Sleeper says TE
        "11": _rec("11", "Patrick Mahomes", "QB", "KC"),
    }
    monkeypatch.setattr(players_mod, "_player_map", records)
    monkeypatch.setattr(players_mod, "_name_index", players_mod._build_name_index(records))
    monkeypatch.setattr(players_mod, "_pos_index", players_mod._build_pos_index(records))

    # A scraper lists Taysom Hill as QB; no QB record exists, but the fallback
    # full scan should still match the TE record by name+team.
    rec = find_player("Taysom Hill", "QB", "NO")
    assert rec is not None
    assert rec.sleeper_id == "10"


def test_no_match_returns_none(seeded_map):
    # Unknown player with no close match in that position.
    assert find_player("Zzzz Nobody", "QB", "XXX") is None


def test_no_candidates_for_unknown_position(seeded_map):
    # Position with no records → no crash, returns None.
    assert find_player("Anyone", "DST", "KC") is None
