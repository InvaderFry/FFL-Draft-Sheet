"""
Provider-agnostic draft-room sync models.

A draft provider fetches the current state of a league's draft from an
external site (ESPN today; Sleeper/Yahoo later) and normalizes it into
DraftStatus. The boundary is deliberately one method — no registry/factory
until a second provider exists.
"""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field


class DraftPick(BaseModel):
    overall: int
    round: int | None = None
    round_pick: int | None = None
    team_id: str
    provider_player_id: str
    # Enriched via the Sleeper player map when the provider id bridges; when
    # it doesn't, name/pos/team may still come from the provider's own player
    # directory with sleeper_id left None. All-None identity fields mean the
    # pick is real but we couldn't identify the player.
    sleeper_id: str | None = None
    player_name: str | None = None
    pos: str | None = None
    nfl_team: str | None = None


class DraftTeam(BaseModel):
    team_id: str
    name: str
    abbrev: str | None = None


class DraftStatus(BaseModel):
    provider: str
    in_progress: bool
    complete: bool
    picks: list[DraftPick] = Field(default_factory=list)
    teams: list[DraftTeam] = Field(default_factory=list)
    fetched_at: float  # unix timestamp, lets the UI show "synced Xs ago"


class DraftProvider(Protocol):
    async def fetch_draft(self, **kwargs) -> DraftStatus: ...
