"""Tests for the Boris Chen tier scaffold (app/data/boris_chen.py)."""

from app.data import boris_chen
from app.engine.tiers import extend_method_tiers
from app.engine.vbd import PlayerVBD


def _player(name, pos="WR", val=10.0):
    return PlayerVBD(
        sleeper_id=None, espn_id=None, player_name=name, pos=pos, team="KC",
        bye_week=10, mean_pts=val + 100, sd_pts=10, n_sources=3,
        baseline=100.0, val=val, floor=val - 10, ceil=val + 10,
    )


def test_loader_returns_empty_when_no_file(tmp_path, monkeypatch):
    monkeypatch.setattr(boris_chen, "_DATA_DIR", tmp_path)
    assert boris_chen.load_boris_chen_tiers(2026, "WR") == {}


def test_apply_is_noop_without_data(tmp_path, monkeypatch):
    monkeypatch.setattr(boris_chen, "_DATA_DIR", tmp_path)
    players = [_player("Ja'Marr Chase"), _player("Justin Jefferson")]
    assert boris_chen.apply_boris_chen_tiers(players, 2026) is False
    assert all("boris_chen" not in p.tiers for p in players)


def test_apply_matches_by_name(tmp_path, monkeypatch):
    season_dir = tmp_path / "2026"
    season_dir.mkdir()
    (season_dir / "WR.csv").write_text(
        "player_name,tier\nJa'Marr Chase,1\nJustin Jefferson,1\nDrake London,2\n"
    )
    monkeypatch.setattr(boris_chen, "_DATA_DIR", tmp_path)
    players = [_player("Ja'Marr Chase"), _player("Drake London"), _player("Totally Unknown")]

    assert boris_chen.apply_boris_chen_tiers(players, 2026) is True
    assert players[0].tiers["boris_chen"] == 1
    assert players[1].tiers["boris_chen"] == 2
    # No match and fuzzy score below threshold → no entry.
    assert "boris_chen" not in players[2].tiers


def test_apply_normalizes_suffix_differences(tmp_path, monkeypatch):
    season_dir = tmp_path / "2026"
    season_dir.mkdir()
    (season_dir / "RB.csv").write_text("player_name,tier\nMarvin Harrison,1\n")
    monkeypatch.setattr(boris_chen, "_DATA_DIR", tmp_path)
    players = [_player("Marvin Harrison Jr.", pos="RB")]

    boris_chen.apply_boris_chen_tiers(players, 2026)
    assert players[0].tiers["boris_chen"] == 1


def test_extend_tiers_deep_players_below_published_list(tmp_path, monkeypatch):
    """Players missing from the published list (the deep tail) get tiered below
    the max published tier instead of collapsing into one flat shade."""
    season_dir = tmp_path / "2026"
    season_dir.mkdir()
    (season_dir / "WR.csv").write_text(
        "player_name,tier\nAlpha,1\nBravo,1\nCharlie,2\n"
    )
    monkeypatch.setattr(boris_chen, "_DATA_DIR", tmp_path)
    # Sorted descending by val; only the first three appear in the CSV.
    players = [
        _player("Alpha", val=50.0), _player("Bravo", val=45.0), _player("Charlie", val=30.0),
        _player("Deep One", val=-5.0), _player("Deep Two", val=-15.0),
        _player("Deep Three", val=-30.0), _player("Deep Four", val=-60.0),
    ]

    assert boris_chen.apply_boris_chen_tiers(players, 2026) is True
    extend_method_tiers(players, boris_chen.BORIS_CHEN_METHOD)

    assert all("boris_chen" in p.tiers for p in players)
    deep = [p.tiers["boris_chen"] for p in players[3:]]
    assert min(deep) == 3   # contiguous after the max published tier (2)
