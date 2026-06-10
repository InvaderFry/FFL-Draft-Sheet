"""
File-based JSON cache with configurable TTL.

Keys are arbitrary strings; values must be JSON-serialisable.
Cache directory is created on first use.

TTL policy (matches plan):
  - preseason  (Jul 1 – Sep 15): 12 hours
  - off-season (everything else): 24 hours
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

CACHE_DIR = Path(os.environ.get("CACHE_DIR", "cache"))


def _ttl_seconds() -> int:
    """Return cache TTL in seconds based on current date."""
    now = datetime.now(timezone.utc)
    # Preseason: July 1 – September 15
    if (now.month == 7) or (now.month == 8) or (now.month == 9 and now.day <= 15):
        return 12 * 3600
    return 24 * 3600


def _key_to_path(key: str) -> Path:
    # Replace characters that are not safe for filenames
    safe = key.replace("/", "_").replace(":", "_").replace(" ", "_")
    return CACHE_DIR / f"{safe}.json"


def get(key: str) -> Any | None:
    """Return cached value or None if missing / expired."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _key_to_path(key)
    if not path.exists():
        return None
    try:
        with path.open() as fh:
            envelope = json.load(fh)
        if time.time() - envelope["ts"] > _ttl_seconds():
            path.unlink(missing_ok=True)
            logger.debug("Cache expired: %s", key)
            return None
        return envelope["value"]
    except Exception as exc:
        logger.warning("Cache read error for %s: %s", key, exc)
        return None


def set(key: str, value: Any) -> None:
    """Store a JSON-serialisable value in the cache.

    Writes go to a unique temp file then os.replace() into place, so
    concurrent writers (worker threads, multiple uvicorn workers) can never
    leave a torn/partial JSON file behind — readers see either the old or
    the new complete entry.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _key_to_path(key)
    tmp_path: str | None = None
    try:
        fd, tmp_path = tempfile.mkstemp(dir=CACHE_DIR, suffix=".tmp")
        with os.fdopen(fd, "w") as fh:
            json.dump({"ts": time.time(), "value": value}, fh)
        os.replace(tmp_path, path)
        tmp_path = None
        logger.debug("Cache written: %s", key)
    except Exception as exc:
        logger.warning("Cache write error for %s: %s", key, exc)
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def delete(key: str) -> None:
    """Remove a cache entry if it exists."""
    _key_to_path(key).unlink(missing_ok=True)


def clear() -> None:
    """Delete all cache entries (useful for testing)."""
    if CACHE_DIR.exists():
        for f in CACHE_DIR.glob("*.json"):
            f.unlink(missing_ok=True)


def clear_projections() -> None:
    """Delete daily cache entries: projections, ADP, and sheets.

    Leaves stable caches (player map, attrition curves) intact so the
    next sheet generation only re-scrapes fresh daily data rather than
    refetching every upstream dataset.
    """
    if CACHE_DIR.exists():
        for pattern in ("proj_*.json", "sheet_*.json", "ffc_adp_*.json"):
            for f in CACHE_DIR.glob(pattern):
                f.unlink(missing_ok=True)
