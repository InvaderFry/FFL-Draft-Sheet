"""Tests for the ESPN draft-room userscript ingest layer (espn_ws)."""

import logging
from unittest.mock import patch

import pytest

from app.providers import espn_ws
from app.providers.base import DraftTeam

SWID = "{E31D96BE-58CE-45C4-9D96-BE58CEB5C4E3}"


@pytest.fixture(autouse=True)
def clear_sessions():
    espn_ws._sessions.clear()
    yield
    espn_ws._sessions.clear()


# ---- parse_frame: lines below are verbatim from the captured HAR ---------------

@pytest.mark.parametrize("line,expected", [
    ("SELECTED 9 3929630 2 {607A4111-1E4D-45C6-A545-7842DD4BAB10}\n",
     ("selected", 9, 3929630)),
    ("SELECTED 2 4426515 4\n", ("selected", 2, 4426515)),  # autopick: no SWID
    ("SELECTING 12 30000\n", ("selecting", 12)),
    ("STATE 1\n", ("state", 1)),
    ("CLOCK 6 29500 2\n", None),
    ("CLOCK 0 82574\n", None),
    ("AUTOSUGGEST 4429795\n", None),
    ("JOINED 12 " + SWID + "\n", None),
    ("LEFT 6 {69C876B8-2558-4F66-8876-B82558AF664E} 0\n", None),
    ("AUTODRAFT 12 false\n", None),
    ("PONG PING%201781294100752\n", None),
    ("TOKEN 12\n", ("token", 12)),
    ("TOKEN 1:1242111363:12:" + SWID + ":1821426335\n", ("token", 12)),
    ("DRAFT_LIST 4429160 4241389\n", None),
    ("", None),
    ("SELECTED garbage not-an-int\n", None),  # malformed -> noise, not a crash
    ("TOKEN 1:1242111363:not-a-team:" + SWID + ":1821426335\n", None),
])
def test_parse_frame(line, expected):
    assert espn_ws.parse_frame(line) == expected


def test_ingest_accumulates_ordered_deduped_enriched_picks():
    directory = {
        "3929630": {"name": "Christian McCaffrey", "pos": "RB", "team": "SF"},
        "4426515": {"name": "CeeDee Lamb", "pos": "WR", "team": "DAL"},
    }
    lines = [
        "AUTODRAFT 12 false\nTOKEN 1:1242111363:12:" + SWID + ":1821426335\n",
        "STATE 1\nSELECTING 1 30000\n",
        "SELECTED 1 3929630 2 {7FD0427D-E8DA-4287-B897-833842B6429A}\n",
        "SELECTING 2 30000\nSELECTED 2 4426515 4\n",
        "SELECTED 2 4426515 4\n",  # resend from the tap; ignored by player id
    ]
    with patch("app.providers.espn.get_player_by_espn_id", return_value=None), patch(
        "app.providers.espn_ws.load_espn_directory", return_value=directory,
    ):
        count = espn_ws.ingest(1242111363, 2026, lines)
        status = espn_ws.snapshot(
            1242111363,
            2026,
            teams=[DraftTeam(team_id="1", name="First Team")],
        )

    assert count == 2
    assert status.in_progress is True
    assert status.complete is False
    assert [p.overall for p in status.picks] == [1, 2]
    assert [p.team_id for p in status.picks] == ["1", "2"]
    assert status.picks[0].provider_player_id == "3929630"
    assert status.picks[0].player_name == "Christian McCaffrey"
    assert status.picks[0].pos == "RB"
    assert status.picks[1].player_name == "CeeDee Lamb"
    assert status.teams[0].name == "First Team"
    assert status.my_team_id == "12"


def test_token_sets_my_team_id_without_creating_pick_or_retaining_swid():
    espn_ws.ingest(1242111363, 2026, [
        "TOKEN 1:1242111363:12:" + SWID + ":1821426335\n",
    ])

    session = espn_ws._sessions[(1242111363, 2026)]
    status = espn_ws.snapshot(1242111363, 2026)

    assert session.my_team_id == "12"
    assert status.my_team_id == "12"
    assert status.picks == []
    assert status.teams == [DraftTeam(team_id="12", name="Team 12")]
    assert SWID not in repr(session)
    assert SWID not in status.model_dump_json()


def test_malformed_raw_token_does_not_log_swid(caplog):
    caplog.set_level(logging.DEBUG, logger="app.providers.espn_ws")

    assert espn_ws.parse_frame(
        "TOKEN 1:1242111363:not-a-team:" + SWID + ":1821426335\n",
    ) is None

    assert SWID not in caplog.text


def test_snapshot_synthesizes_teams_from_picks_and_my_team_when_missing():
    directory = {
        "3929630": {"name": "Christian McCaffrey", "pos": "RB", "team": "SF"},
        "4426515": {"name": "CeeDee Lamb", "pos": "WR", "team": "DAL"},
    }
    lines = [
        "TOKEN 7\n",
        "STATE 1\n",
        "SELECTED 3 3929630 2\n",
        "SELECTED 10 4426515 4\n",
    ]
    with patch("app.providers.espn.get_player_by_espn_id", return_value=None), patch(
        "app.providers.espn_ws.load_espn_directory", return_value=directory,
    ):
        espn_ws.ingest(1242111363, 2026, lines)

    status = espn_ws.snapshot(1242111363, 2026)

    assert status.my_team_id == "7"
    assert [team.team_id for team in status.teams] == ["3", "7", "10"]
    assert [team.name for team in status.teams] == ["Team 3", "Team 7", "Team 10"]


def test_complete_flag_flips_snapshot_out_of_in_progress():
    with patch("app.providers.espn.get_player_by_espn_id", return_value=None), patch(
        "app.providers.espn_ws.load_espn_directory", return_value={},
    ):
        espn_ws.ingest(123, 2026, ["STATE 1\nSELECTED 4 9999999 2\n"])
        espn_ws.ingest(123, 2026, [], complete=True)

    status = espn_ws.snapshot(123, 2026)
    assert status.complete is True
    assert status.in_progress is False
    assert len(status.picks) == 1


def test_empty_snapshot_is_waiting_state_and_reuses_registry_entry():
    first = espn_ws.snapshot(123, 2026, teams=[DraftTeam(team_id="4", name="Team Four")])
    assert first.picks == []
    assert first.in_progress is False
    assert first.complete is False
    assert first.teams[0].name == "Team Four"

    key = (123, 2026)
    session = espn_ws._sessions[key]
    second = espn_ws.snapshot(123, 2026)
    assert espn_ws._sessions[key] is session
    assert second.teams[0].name == "Team Four"


def test_registry_evicts_idle_sessions(monkeypatch):
    espn_ws.snapshot(123, 2026)
    first = espn_ws._sessions[(123, 2026)]

    first.last_polled -= espn_ws.IDLE_EVICT_S + 1
    espn_ws.snapshot(456, 2026)

    assert (123, 2026) not in espn_ws._sessions
    assert (456, 2026) in espn_ws._sessions
