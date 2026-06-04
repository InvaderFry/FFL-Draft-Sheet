"""
U2 — Player identity layer.

Fetches the Sleeper /v1/players/nfl endpoint and produces a canonical lookup
mapping sleeper_id → player record, bridged to ESPN, Yahoo, MFL, and GSIS IDs
via nfl_data_py import_ids().

Public API:
    load_player_map(force_refresh=False) -> dict[str, PlayerRecord]
    get_player(sleeper_id: str) -> PlayerRecord | None
    find_player(name: str, pos: str, team: str) -> PlayerRecord | None
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx
from rapidfuzz import fuzz

from app import cache

logger = logging.getLogger(__name__)

SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
CACHE_KEY = "sleeper_players"
POSITIONS_OF_INTEREST = {"QB", "RB", "WR", "TE", "DST", "K", "DEF"}

_player_map: dict[str, "PlayerRecord"] | None = None
_name_index: dict[str, list["PlayerRecord"]] = {}


@dataclass
class PlayerRecord:
    sleeper_id: str
    first_name: str
    last_name: str
    full_name: str
    position: str
    team: str | None
    bye_week: int | None
    espn_id: str | None = None
    yahoo_id: str | None = None
    mfl_id: str | None = None
    gsis_id: str | None = None
    # warning flag for partial records
    partial: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def name_key(self) -> str:
        """Normalised name+pos+team for fuzzy matching."""
        return f"{self.full_name.lower().strip()} {self.position} {(self.team or '').lower()}"


def _parse_sleeper_response(raw: dict[str, Any]) -> dict[str, PlayerRecord]:
    records: dict[str, PlayerRecord] = {}
    for sid, data in raw.items():
        pos = (data.get("position") or "").upper()
        if pos not in POSITIONS_OF_INTEREST and pos != "DEF":
            continue
        # Normalise DEF → DST
        if pos == "DEF":
            pos = "DST"
        fname = data.get("first_name") or ""
        lname = data.get("last_name") or ""
        full = data.get("full_name") or f"{fname} {lname}".strip()
        records[sid] = PlayerRecord(
            sleeper_id=sid,
            first_name=fname,
            last_name=lname,
            full_name=full,
            position=pos,
            team=data.get("team"),
            bye_week=data.get("bye_week"),
            espn_id=str(data["espn_id"]) if data.get("espn_id") else None,
            yahoo_id=str(data["yahoo_id"]) if data.get("yahoo_id") else None,
            mfl_id=str(data["mfl_id"]) if data.get("mfl_id") else None,
        )
    return records


def _bridge_gsis_ids(records: dict[str, PlayerRecord]) -> None:
    """Attempt to load nfl_data_py id crosswalk and fill gsis_id."""
    try:
        import nfl_data_py as nfl  # type: ignore

        ids_df = nfl.import_ids()
        # Build espn_id → gsis_id map
        espn_to_gsis: dict[str, str] = {}
        for _, row in ids_df.iterrows():
            eid = str(row.get("espn_id", "") or "")
            gid = str(row.get("gsis_id", "") or "")
            if eid and gid and eid != "nan" and gid != "nan":
                espn_to_gsis[eid] = gid

        matched = 0
        for rec in records.values():
            if rec.espn_id and rec.espn_id in espn_to_gsis:
                rec.gsis_id = espn_to_gsis[rec.espn_id]
                matched += 1
        logger.info("Bridged %d GSIS IDs from nflverse crosswalk", matched)
    except Exception as exc:
        logger.warning("Could not load nflverse ID crosswalk: %s", exc)


def _build_name_index(records: dict[str, PlayerRecord]) -> dict[str, list[PlayerRecord]]:
    idx: dict[str, list[PlayerRecord]] = {}
    for rec in records.values():
        key = rec.full_name.lower().strip()
        idx.setdefault(key, []).append(rec)
    return idx


def load_player_map(force_refresh: bool = False) -> dict[str, PlayerRecord]:
    """
    Return the full Sleeper player map.  Results are cached (file cache + module-level).
    """
    global _player_map, _name_index

    if _player_map is not None and not force_refresh:
        return _player_map

    # Try file cache first
    if not force_refresh:
        cached = cache.get(CACHE_KEY)
        if cached is not None:
            logger.info("Player map loaded from file cache (%d players)", len(cached))
            # Reconstruct dataclasses from dicts
            _player_map = {sid: PlayerRecord(**v) for sid, v in cached.items()}
            _name_index = _build_name_index(_player_map)
            return _player_map

    # Fetch from Sleeper
    logger.info("Fetching player map from Sleeper API…")
    try:
        resp = httpx.get(SLEEPER_PLAYERS_URL, timeout=30.0)
        resp.raise_for_status()
        raw = resp.json()
    except Exception as exc:
        logger.error("Sleeper API fetch failed: %s", exc)
        _player_map = {}
        _name_index = {}
        return _player_map

    records = _parse_sleeper_response(raw)
    _bridge_gsis_ids(records)

    # Persist to file cache (store as plain dicts)
    cache.set(CACHE_KEY, {sid: rec.__dict__ for sid, rec in records.items()})
    logger.info("Player map: %d players cached", len(records))

    _player_map = records
    _name_index = _build_name_index(_player_map)
    return _player_map


def get_player(sleeper_id: str) -> PlayerRecord | None:
    """Look up a player by exact Sleeper ID."""
    m = load_player_map()
    return m.get(sleeper_id)


def find_player(name: str, pos: str, team: str) -> PlayerRecord | None:
    """
    Fuzzy-match a player by name + position + team.
    Returns the best match if score ≥ 88, else None.
    """
    load_player_map()
    query = f"{name.lower().strip()} {pos.upper()} {team.lower()}"

    best_score = 0
    best_rec: PlayerRecord | None = None
    candidates = list(_player_map.values()) if _player_map else []

    # Fast path: exact name match
    exact = _name_index.get(name.lower().strip(), [])
    if exact:
        for rec in exact:
            if rec.position == pos.upper():
                return rec

    for rec in candidates:
        score = fuzz.WRatio(query, rec.name_key)
        if score > best_score:
            best_score = score
            best_rec = rec

    if best_score >= 88:
        return best_rec
    logger.debug("No match for '%s' %s %s (best score=%d)", name, pos, team, best_score)
    return None
