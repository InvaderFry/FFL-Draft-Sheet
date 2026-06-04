"""Tests for the file-based JSON cache (TTL + round-trip)."""

from datetime import datetime, timezone

import pytest

from app import cache


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Point the cache at a temp dir and clear it around each test."""
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")
    yield
    cache.clear()


def test_set_get_round_trip():
    cache.set("k1", {"a": 1, "b": [1, 2, 3]})
    assert cache.get("k1") == {"a": 1, "b": [1, 2, 3]}


def test_missing_key_returns_none():
    assert cache.get("does_not_exist") is None


def test_delete_removes_entry():
    cache.set("k2", 42)
    cache.delete("k2")
    assert cache.get("k2") is None


def test_expired_entry_is_evicted(monkeypatch):
    cache.set("k3", "value")
    # Jump forward well past any TTL window.
    real_time = cache.time.time()
    monkeypatch.setattr(cache.time, "time", lambda: real_time + 10 * 24 * 3600)
    assert cache.get("k3") is None


def test_key_with_unsafe_chars_is_sanitised():
    # Keys containing path separators / colons / spaces must not escape the dir.
    cache.set("sheet/2026:12t half ppr", [1, 2])
    assert cache.get("sheet/2026:12t half ppr") == [1, 2]


# ---- TTL policy (preseason vs off-season) ------------------------------------

class _FakeDatetime:
    """datetime stub whose now() returns a fixed instant."""

    _fixed = None

    @classmethod
    def now(cls, tz=None):
        return cls._fixed


@pytest.mark.parametrize(
    "month,day,expected_hours",
    [
        (7, 1, 12),    # preseason start
        (8, 20, 12),   # preseason
        (9, 15, 12),   # preseason last day
        (9, 16, 24),   # off-season resumes
        (1, 10, 24),   # deep off-season
        (12, 31, 24),
    ],
)
def test_ttl_preseason_vs_offseason(monkeypatch, month, day, expected_hours):
    _FakeDatetime._fixed = datetime(2026, month, day, tzinfo=timezone.utc)
    monkeypatch.setattr(cache, "datetime", _FakeDatetime)
    assert cache._ttl_seconds() == expected_hours * 3600
