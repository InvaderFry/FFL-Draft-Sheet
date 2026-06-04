"""Shared pytest fixtures."""

import pytest

from tests.factories import build_league


@pytest.fixture
def make_league():
    """Factory fixture returning build_league (canonical LeagueConfig + overrides)."""
    return build_league
