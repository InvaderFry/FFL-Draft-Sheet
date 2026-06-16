"""Tests for the Boris Chen tier scaffold (app/data/boris_chen.py)."""

from app.data import boris_chen
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
