"""
U2 — Player identity layer.

Fetches the Sleeper /v1/players/nfl endpoint and produces a canonical lookup
mapping sleeper_id → player record, bridged to ESPN, Yahoo, MFL, and GSIS IDs
via nfl_data_py import_ids().

Public API:
    canonical_key(row: dict) -> str
    load_player_map(force_refresh=False) -> dict[str, PlayerRecord]
    load_player_map_async(force_refresh=False) -> dict[str, PlayerRecord]
    get_player(sleeper_id: str) -> PlayerRecord | None
    get_player_by_espn_id(espn_id: str) -> PlayerRecord | None
    find_player(name: str, pos: str, team: str) -> PlayerRecord | None
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from rapidfuzz import fuzz

from app import cache
from app.config import POSITIONS

logger = logging.getLogger(__name__)

SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
CACHE_KEY = "sleeper_players"
# Ingest the scored positions (config.POSITIONS) plus Sleeper's "DEF" spelling,
# which _parse_sleeper_response normalises to "DST". Deliberately no "K":
# kickers have no projection sources here, and adding them would pollute
# find_player's cross-position fuzzy scan during sheet building. Draft picks
# of kickers are still named via the ESPN player directory fallback
# (app.data.espn_players).
POSITIONS_OF_INTEREST = set(POSITIONS) | {"DEF"}
# After a failed Sleeper fetch, retry on the next call after this window
# instead of memoizing the empty map for the process lifetime.
RETRY_AFTER_FAILURE = 300

_player_map: dict[str, "PlayerRecord"] | None = None
_load_failed_at: float | None = None
_name_index: dict[str, list["PlayerRecord"]] = {}
_pos_index: dict[str, list["PlayerRecord"]] = {}
_espn_index: dict[str, "PlayerRecord"] = {}
# load_player_map runs in worker threads (asyncio.to_thread call sites), so
# initialization of the globals above must be serialized.
_load_lock = threading.Lock()


def canonical_key(row: dict) -> str:
    """Canonical grouping identity for a projection row.

    Prefer Sleeper ID; fall back to normalized name+team. The prefixes prevent
    a numeric Sleeper ID from colliding with a player name.
    """
    sid = row.get("sleeper_id")
    if sid:
        return f"sid:{sid}"
    name = (row.get("player_name") or "").strip().lower()
    team = (row.get("team") or "").strip().lower()
    return f"name:{name}:{team}"


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


def _build_indexes(
    records: dict[str, PlayerRecord],
) -> tuple[dict[str, list[PlayerRecord]], dict[str, list[PlayerRecord]], dict[str, PlayerRecord]]:
    """
    Build the lookup indexes in a single pass over the records:
      - name_index: full_name (lowercased) → records, for the exact-name fast path
      - pos_index:  position → records, so fuzzy matching can scan same-position
                    candidates instead of the full ~11k-player map
      - espn_index: espn_id → record, for draft-pick enrichment
    """
    name_idx: dict[str, list[PlayerRecord]] = {}
    pos_idx: dict[str, list[PlayerRecord]] = {}
    espn_idx: dict[str, PlayerRecord] = {}
    for rec in records.values():
        name_idx.setdefault(rec.full_name.lower().strip(), []).append(rec)
        pos_idx.setdefault(rec.position, []).append(rec)
        if rec.espn_id:
            espn_idx[rec.espn_id] = rec
    return name_idx, pos_idx, espn_idx


def _memo_usable() -> bool:
    """True if the memoized map can be returned without a reload.

    A map left empty by a failed fetch only counts while the retry cooldown
    is running — after that the next caller retries Sleeper instead of
    serving the degraded map for the rest of the process lifetime.
    """
    if _player_map is None:
        return False
    if _player_map or _load_failed_at is None:
        return True
    return time.time() - _load_failed_at < RETRY_AFTER_FAILURE


def load_player_map(force_refresh: bool = False) -> dict[str, PlayerRecord]:
    """
    Return the full Sleeper player map.  Results are cached (file cache + module-level).
    """
    global _player_map, _name_index, _pos_index, _espn_index, _load_failed_at

    if not force_refresh and _memo_usable():
        return _player_map

    with _load_lock:
        # Re-check under the lock: another thread may have finished loading
        # while this one waited.
        if not force_refresh and _memo_usable():
            return _player_map

        # Try file cache first
        if not force_refresh:
            cached = cache.get(CACHE_KEY)
            if cached is not None:
                logger.info("Player map loaded from file cache (%d players)", len(cached))
                # Reconstruct dataclasses from dicts
                player_map = {sid: PlayerRecord(**v) for sid, v in cached.items()}
                _name_index, _pos_index, _espn_index = _build_indexes(player_map)
                _load_failed_at = None
                _player_map = player_map
                return _player_map

        # Fetch from Sleeper
        logger.info("Fetching player map from Sleeper API…")
        try:
            resp = httpx.get(SLEEPER_PLAYERS_URL, timeout=30.0)
            resp.raise_for_status()
            raw = resp.json()
        except Exception as exc:
            logger.error("Sleeper API fetch failed: %s", exc)
            _load_failed_at = time.time()
            _player_map = {}
            _name_index = {}
            _pos_index = {}
            _espn_index = {}
            return _player_map

        records = _parse_sleeper_response(raw)
        _bridge_gsis_ids(records)

        # Persist to file cache (store as plain dicts)
        cache.set(CACHE_KEY, {sid: rec.__dict__ for sid, rec in records.items()})
        logger.info("Player map: %d players cached", len(records))

        _name_index, _pos_index, _espn_index = _build_indexes(records)
        # Assign _player_map last: lock-free readers (get_player_by_espn_id)
        # treat it as the "loaded" flag, so the indexes must be in place first.
        _load_failed_at = None
        _player_map = records
        return _player_map


async def load_player_map_async(force_refresh: bool = False) -> dict[str, PlayerRecord]:
    """
    Async-safe entry point for event-loop callers.

    On a cold cache load_player_map does a synchronous ~11k-player Sleeper
    fetch (up to 30s) plus file I/O, so it must not run on the event loop.
    Use this from async code instead of wrapping the sync function ad hoc.
    """
    return await asyncio.to_thread(load_player_map, force_refresh)


def get_player(sleeper_id: str) -> PlayerRecord | None:
    """Look up a player by exact Sleeper ID."""
    m = load_player_map()
    return m.get(sleeper_id)


def get_player_by_espn_id(espn_id: str) -> PlayerRecord | None:
    """Look up a player by exact ESPN ID."""
    load_player_map()
    return _espn_index.get(espn_id)


def find_player(name: str, pos: str, team: str) -> PlayerRecord | None:
    """
    Fuzzy-match a player by name + position + team.
    Returns the best match if score ≥ 88, else None.
    """
    load_player_map()
    pos_upper = pos.upper()
    query = f"{name.lower().strip()} {pos_upper} {team.lower()}"

    def _best_match(records: list[PlayerRecord]) -> tuple[int, PlayerRecord | None]:
        best_score = 0
        best_rec: PlayerRecord | None = None
        for rec in records:
            score = fuzz.WRatio(query, rec.name_key)
            if score > best_score:
                best_score = score
                best_rec = rec
        return best_score, best_rec

    # Fast path: exact name match
    exact = _name_index.get(name.lower().strip(), [])
    if exact:
        for rec in exact:
            if rec.position == pos_upper:
                return rec

    # Fuzzy-match same-position candidates first — this keeps the common case to
    # a few hundred records instead of the full ~11k-player map.
    best_score, best_rec = _best_match(_pos_index.get(pos_upper, []))
    if best_score >= 88:
        return best_rec

    # Fallback: a source may classify a multi-position player differently than
    # Sleeper (e.g. Taysom Hill QB vs TE, Cordarrelle Patterson RB vs WR), so the
    # same-position pass misses them.  Scan only the OTHER position buckets (the
    # same-position bucket already failed above) and keep the better result.
    # A team defense is never cross-listed, so skip this for DST.
    if pos_upper != "DST":
        for other_pos, recs in _pos_index.items():
            if other_pos == pos_upper:
                continue
            score, rec = _best_match(recs)
            if score > best_score:
                best_score, best_rec = score, rec
        if best_score >= 88:
            return best_rec

    logger.debug("No match for '%s' %s %s (best score=%d)", name, pos, team, best_score)
    return None
