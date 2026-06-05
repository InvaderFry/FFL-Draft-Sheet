"""
FastAPI application — BeerSheets MVP backend.

Endpoints:
  GET  /health            → liveness check
  POST /api/sheet         → generate a VBD draft sheet for the given league config
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import LeagueConfig, POSITIONS
from app import cache
from app.data.players import load_player_map
from app.data.scraper import ADAPTERS, scrape_all
from app.data.historical import load_attrition_curves
from app.data.adp import enrich_with_adp
from app.engine.baseline import compute_baselines
from app.engine.vbd import aggregate_projections, PlayerVBD
from app.engine.tiers import assign_tiers
from app.engine.scarcity import assign_positional_scarcity, assign_auction_prices

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="BeerSheets MVP",
    description="Free VBD fantasy football draft cheat sheet API",
    version="0.1.0",
)

# NOTE: the API is stateless and uses no cookies/auth, so credentials are not
# allowed.  This lets us safely use the "*" wildcard origin — the CORS spec
# forbids combining `Access-Control-Allow-Origin: *` with credentials, and
# browsers reject such responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Response models
# --------------------------------------------------------------------------- #

class PlayerRow(BaseModel):
    sleeper_id: str | None
    espn_id: str | None
    player_name: str
    pos: str
    team: str
    bye_week: int | None
    val: float
    floor: float
    ceil: float
    ps_pct: float
    n_sources: int
    pos_rank: int
    adp_rank: int | None
    ecr_rank: int | None
    ecr_fmt: str
    tier: int
    tier_is_even: bool
    auction_price: float | None


class SourceFailure(BaseModel):
    position: str
    reason: str


class SourceStatus(BaseModel):
    source: str
    status: str
    used: bool
    positions: list[str]
    reason: str | None = None
    failures: list[SourceFailure] = Field(default_factory=list)


class SheetMetadata(BaseModel):
    season: int
    n_teams: int
    ppr: float
    sources_used: list[str]
    sources_dropped: list[str]
    source_statuses: list[SourceStatus] = Field(default_factory=list)
    baselines: dict[str, float]
    adp_available: bool
    cache_hit: bool
    generation_time_s: float


class SheetResponse(BaseModel):
    positions: dict[str, list[PlayerRow]]
    metadata: SheetMetadata


# --------------------------------------------------------------------------- #
# Sheet cache key
# --------------------------------------------------------------------------- #

def _sheet_cache_key(cfg: LeagueConfig) -> str:
    from datetime import date
    ppr = cfg.scoring.rec
    return (
        f"sheet_{cfg.season}_{cfg.n_teams}t_{ppr}ppr_"
        f"{cfg.qb}QB{cfg.rb}RB{cfg.wr}WR{cfg.te}TE_{cfg.flex_slots}FLEX_"
        f"{cfg.fantasy_weeks}wk_{date.today()}"
    )


# --------------------------------------------------------------------------- #
# Source status aggregation
# --------------------------------------------------------------------------- #

def _outcome_value(outcome: Any, key: str, default: Any = None) -> Any:
    return getattr(outcome, key, default)


def _aggregate_source_metadata(raw_by_pos: dict[str, list[dict]]) -> tuple[list[str], list[str], list[dict]]:
    all_sources: set[str] = set()
    positions_by_source: dict[str, set[str]] = {}
    failures_by_source: dict[str, list[dict]] = {}

    if not hasattr(raw_by_pos, "outcomes"):
        for pos, rows in raw_by_pos.items():
            for row in rows:
                source = row.get("source", "unknown")
                all_sources.add(source)
                positions_by_source.setdefault(source, set()).add(pos)

    for outcome in getattr(raw_by_pos, "outcomes", []):
        source = _outcome_value(outcome, "source")
        position = _outcome_value(outcome, "position")
        rows = int(_outcome_value(outcome, "rows", 0) or 0)
        reason = _outcome_value(outcome, "reason")
        if not source:
            continue
        all_sources.add(source)
        if rows > 0 and position:
            positions_by_source.setdefault(source, set()).add(position)
        elif reason and position:
            failures_by_source.setdefault(source, []).append({
                "position": position,
                "reason": reason,
            })

    source_statuses: list[dict] = []
    for source in sorted(all_sources):
        positions = sorted(positions_by_source.get(source, set()))
        failures = failures_by_source.get(source, [])
        used = bool(positions)
        if used and failures:
            status = "partial"
        elif used:
            status = "used"
        else:
            status = "unavailable"

        reason = None
        if status == "unavailable":
            reason = failures[0]["reason"] if failures else "0 rows"

        source_statuses.append({
            "source": source,
            "status": status,
            "used": used,
            "positions": positions,
            "reason": reason,
            "failures": failures,
        })

    sources_used = [entry["source"] for entry in source_statuses if entry["used"]]
    sources_dropped = [entry["source"] for entry in source_statuses if not entry["used"]]
    return sources_used, sources_dropped, source_statuses


def _legacy_source_statuses(sources_used: list[str], sources_dropped: list[str]) -> list[dict]:
    return [
        {
            "source": source,
            "status": "used",
            "used": True,
            "positions": [],
            "reason": None,
            "failures": [],
        }
        for source in sources_used
    ] + [
        {
            "source": source,
            "status": "unavailable",
            "used": False,
            "positions": [],
            "reason": "0 rows",
            "failures": [],
        }
        for source in sources_dropped
    ]


# --------------------------------------------------------------------------- #
# Core pipeline
# --------------------------------------------------------------------------- #

async def _generate_sheet(cfg: LeagueConfig) -> dict[str, Any]:
    t0 = time.perf_counter()

    # 1. Load player map (for bye weeks + ID bridging)
    player_map = load_player_map()

    # 2. Scrape projections for all positions
    raw_by_pos = await scrape_all(cfg)
    sources_used, sources_dropped, source_statuses = _aggregate_source_metadata(raw_by_pos)

    # 3. Load attrition curves
    curves = load_attrition_curves(cfg.season)

    # 4. Build mean-points-by-rank for baseline computation
    pos_projections: dict[str, list[float]] = {}
    for pos in POSITIONS:
        rows = raw_by_pos.get(pos, [])
        # Group by player, take mean, sort descending
        groups: dict[str, list[float]] = {}
        for r in rows:
            key = r.get("sleeper_id") or r.get("player_name", "")
            groups.setdefault(key, []).append(float(r.get("points", 0)))
        means = sorted([sum(v) / len(v) for v in groups.values()], reverse=True)
        pos_projections[pos] = means

    # 5. Compute baselines
    baselines = compute_baselines(cfg, curves, pos_projections)

    # 6. Aggregate VBD per position
    all_players: list[PlayerVBD] = []
    position_players: dict[str, list[PlayerVBD]] = {}

    ppr = cfg.scoring.rec
    for pos in POSITIONS:
        rows = raw_by_pos.get(pos, [])
        players = aggregate_projections(rows, pos, baselines.get(pos, 0.0), player_map)
        players = assign_tiers(players)
        players = assign_positional_scarcity(players)
        position_players[pos] = players
        all_players.extend(players)

    # 7. Auction prices (across all positions)
    if cfg.auction_mode:
        assign_auction_prices(all_players, cfg)

    # 8. ADP enrichment
    adp_available = False
    for pos, players in position_players.items():
        rows = [p.__dict__ for p in players]
        enriched, pos_adp_ok = enrich_with_adp(rows, cfg.n_teams, ppr)
        adp_available = adp_available or pos_adp_ok
        for p, row in zip(players, enriched):
            p.adp_rank = row.get("adp_rank")
            p.ecr_rank = row.get("ecr_rank")
            p.ecr_fmt = row.get("ecr_fmt", "—")

    # 9. Serialize
    result_positions: dict[str, list[dict]] = {}
    for pos in POSITIONS:
        result_positions[pos] = [p.to_dict() for p in position_players.get(pos, [])]

    elapsed = time.perf_counter() - t0
    return {
        "positions": result_positions,
        "metadata": {
            "season": cfg.season,
            "n_teams": cfg.n_teams,
            "ppr": ppr,
            "sources_used": sources_used,
            "sources_dropped": sources_dropped,
            "source_statuses": source_statuses,
            "baselines": {k: round(v, 1) for k, v in baselines.items()},
            "adp_available": adp_available,
            "cache_hit": False,
            "generation_time_s": round(elapsed, 2),
        },
    }


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


@app.post("/api/sheet", response_model=SheetResponse)
async def generate_sheet(cfg: LeagueConfig) -> SheetResponse:
    ck = _sheet_cache_key(cfg)
    cached = cache.get(ck)
    if cached is not None:
        metadata = cached["metadata"]
        metadata["cache_hit"] = True
        if "source_statuses" not in metadata:
            metadata["source_statuses"] = _legacy_source_statuses(
                metadata.get("sources_used", []),
                metadata.get("sources_dropped", []),
            )
        return SheetResponse(**cached)

    try:
        result = await _generate_sheet(cfg)
    except Exception as exc:
        logger.exception("Sheet generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    cache.set(ck, result)
    return SheetResponse(**result)
