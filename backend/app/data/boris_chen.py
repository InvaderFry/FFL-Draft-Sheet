"""
Boris Chen tier integration (scaffold).

Boris Chen publishes per-position, per-scoring tier lists (borischen.co) derived
from a Gaussian-mixture clustering of expert ranks. When a tier file for the
season is present under ``app/data/boris_chen/<season>/<POS>.csv`` we map those
tiers onto our players by name; otherwise this is inert — no player gets a
``boris_chen`` entry in their tiers map and the UI option stays disabled.

CSV format (one row per player)::

    player_name,tier
    Ja'Marr Chase,1
    Justin Jefferson,1
    ...

This keeps the wiring in place so that dropping in a CSV — old data for testing,
or the 2026 list once published — lights the method up end to end with no code
changes.
"""

from __future__ import annotations

import csv
import logging
import re
from pathlib import Path

from rapidfuzz import fuzz

from app.engine.vbd import PlayerVBD

logger = logging.getLogger(__name__)

BORIS_CHEN_METHOD = "boris_chen"
_DATA_DIR = Path(__file__).parent / "boris_chen"
# Minimum fuzzy score to accept a name match when there is no exact normalized hit.
_FUZZY_THRESHOLD = 88


def _normalize(name: str) -> str:
    """Lowercase, strip punctuation and common suffixes for name matching."""
    n = name.lower().strip()
    n = re.sub(r"[.'`]", "", n)
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", n)
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def _csv_path(season: int, pos: str) -> Path:
    return _DATA_DIR / str(season) / f"{pos.upper()}.csv"


def load_boris_chen_tiers(season: int, pos: str) -> dict[str, int]:
    """
    Load the Boris Chen tier list for a season/position as ``{normalized_name:
    tier}``. Returns ``{}`` when no file exists (the scaffold's default state).
    """
    path = _csv_path(season, pos)
    if not path.exists():
        return {}

    tiers: dict[str, int] = {}
    try:
        with path.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                name = row.get("player_name") or row.get("Player") or ""
                raw_tier = row.get("tier") or row.get("Tier")
                if not name or raw_tier is None:
                    continue
                try:
                    tiers[_normalize(name)] = int(float(raw_tier))
                except (TypeError, ValueError):
                    continue
    except OSError as exc:
        logger.warning("failed reading Boris Chen tiers %s: %s", path, exc)
        return {}

    return tiers


def apply_boris_chen_tiers(players: list[PlayerVBD], season: int) -> bool:
    """
    Populate ``p.tiers["boris_chen"]`` for each matched player (mutates in
    place). No-op when no tier file is present. Returns True if any player was
    matched, so callers/UI can tell whether the method is available.
    """
    if not players:
        return False

    pos = players[0].pos
    name_to_tier = load_boris_chen_tiers(season, pos)
    if not name_to_tier:
        return False

    matched = 0
    for p in players:
        norm = _normalize(p.player_name)
        tier = name_to_tier.get(norm)
        if tier is None:
            # Fuzzy fallback for spelling/suffix differences.
            best_name, best_score = None, 0
            for candidate in name_to_tier:
                score = fuzz.ratio(norm, candidate)
                if score > best_score:
                    best_name, best_score = candidate, score
            if best_name is not None and best_score >= _FUZZY_THRESHOLD:
                tier = name_to_tier[best_name]
        if tier is not None:
            p.tiers[BORIS_CHEN_METHOD] = tier
            matched += 1

    if matched:
        logger.info("Boris Chen tiers applied: %d/%d %s matched", matched, len(players), pos)
    return matched > 0
