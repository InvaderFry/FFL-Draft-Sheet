"""
FastAPI application — BeerSheets MVP backend.

Endpoints:
  GET  /health            → liveness check
  POST /api/sheet         → generate a VBD draft sheet for the given league config
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, SecretStr

from app.config import LeagueConfig, POSITIONS
from app import cache
from app.providers import espn as espn_provider
from app.providers.base import DraftStatus
from app.data.players import canonical_key, load_player_map_async
from app.data.scraper import scrape_all
from app.data.historical import load_attrition_curves
from app.data.variance import load_variance
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
    mean_pts: float
    baseline: float
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
    data_quality_warnings: list[str] = Field(default_factory=list)
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
        f"{cfg.fantasy_weeks}wk_{cfg.bench_spots}bench_{date.today()}"
    )


# --------------------------------------------------------------------------- #
# Source status aggregation
# --------------------------------------------------------------------------- #

EXPECTED_MAX_MEAN_POINTS = {
    "QB": 500.0,
    "RB": 400.0,
    "WR": 400.0,
    "TE": 300.0,
    "DST": 200.0,
}

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


def _projection_quality_warnings(pos_projections: dict[str, list[float]]) -> list[str]:
    warnings: list[str] = []
    for pos in POSITIONS:
        ceiling = EXPECTED_MAX_MEAN_POINTS.get(pos)
        projections = pos_projections.get(pos, [])
        if ceiling is None or not projections:
            continue

        top_mean = projections[0]
        if top_mean > ceiling:
            warnings.append(
                f"{pos} projections appear inflated "
                f"(top mean_pts={top_mean:.1f}, expected <={ceiling:.0f}). "
                "Data may be unreliable this early in the season."
            )
    return warnings


def _backfill_cached_diagnostic_fields(sheet: dict[str, Any]) -> None:
    metadata = sheet.setdefault("metadata", {})
    metadata.setdefault("data_quality_warnings", [])

    baselines = metadata.get("baselines", {})
    for pos, rows in sheet.get("positions", {}).items():
        baseline = float(baselines.get(pos, 0.0))
        for row in rows:
            row.setdefault("baseline", round(baseline, 1))
            if "mean_pts" in row:
                continue
            if "floor" in row and "ceil" in row:
                mean_above_baseline = (float(row["floor"]) + float(row["ceil"])) / 2
                row["mean_pts"] = round(baseline + mean_above_baseline, 1)
            elif "val" in row:
                row["mean_pts"] = round(baseline + float(row["val"]), 1)


# --------------------------------------------------------------------------- #
# Core pipeline
# --------------------------------------------------------------------------- #

async def _generate_sheet(cfg: LeagueConfig) -> dict[str, Any]:
    t0 = time.perf_counter()

    # 1. Load player map (for bye weeks + ID bridging)
    player_map = await load_player_map_async()

    # 2. Scrape projections for all positions
    raw_by_pos = await scrape_all(cfg)
    sources_used, sources_dropped, source_statuses = _aggregate_source_metadata(raw_by_pos)

    # 3. Load attrition curves
    curves = load_attrition_curves(cfg.season)
    variance = load_variance(cfg.season)

    # 4. Build mean-points-by-rank for baseline computation
    pos_projections: dict[str, list[float]] = {}
    for pos in POSITIONS:
        rows = raw_by_pos.get(pos, [])
        # Group by player, take mean, sort descending
        groups: dict[str, list[float]] = {}
        for r in rows:
            key = canonical_key(r)
            groups.setdefault(key, []).append(float(r.get("points", 0)))
        means = sorted([sum(v) / len(v) for v in groups.values()], reverse=True)
        pos_projections[pos] = means

    data_quality_warnings = _projection_quality_warnings(pos_projections)

    # 5. Compute baselines
    baselines = compute_baselines(cfg, curves, pos_projections)

    # 6. Aggregate VBD per position
    all_players: list[PlayerVBD] = []
    position_players: dict[str, list[PlayerVBD]] = {}

    ppr = cfg.scoring.rec
    for pos in POSITIONS:
        rows = raw_by_pos.get(pos, [])
        players = aggregate_projections(rows, pos, baselines.get(pos, 0.0), player_map, variance=variance)
        players = assign_tiers(players)
        players = assign_positional_scarcity(players)
        position_players[pos] = players
        all_players.extend(players)

    # 7. Auction prices (across all positions)
    if cfg.auction_mode:
        assign_auction_prices(all_players, cfg)

    # 8. ADP enrichment — one call across all positions, so the FFC fetch
    # (and its cache-file read) happens once per request instead of once per
    # position. Still off the event loop for the cold-cache HTTP case.
    all_rows = [p.__dict__ for p in all_players]
    enriched, adp_available = await asyncio.to_thread(enrich_with_adp, all_rows, cfg.n_teams, ppr)
    for p, row in zip(all_players, enriched):
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
            "data_quality_warnings": data_quality_warnings,
            "adp_available": adp_available,
            "cache_hit": False,
            "generation_time_s": round(elapsed, 2),
        },
    }


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

@app.get("/")
async def root() -> dict:
    return {
        "status": "ok",
        "service": app.title,
        "version": app.version,
        **({"docs": app.docs_url} if app.docs_url else {}),
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": app.version}


# No auth required — this cache holds only public, regeneratable data
# (scraped projections, ADP, and draft sheets). A secret the owner
# never has is more harmful than an open endpoint.
@app.post("/api/cache/clear")
async def clear_cache() -> dict:
    cache.clear_projections()
    return {"status": "cleared"}


class EspnDraftRequest(BaseModel):
    league_id: int
    season: int = Field(ge=2018, le=2035)
    # SecretStr so the credentials never appear in reprs/validation errors.
    espn_s2: SecretStr | None = None
    swid: SecretStr | None = None


# Stateless per-request proxy: draft picks must be fresh, so no caching here
# (the file cache's TTL floor is hours). Cookies travel in the POST body —
# never as browser cookies — which keeps the wildcard-CORS setup above valid.
@app.post("/api/draft/espn", response_model=DraftStatus)
async def espn_draft_status(req: EspnDraftRequest) -> DraftStatus:
    try:
        return await espn_provider.fetch_draft(
            league_id=req.league_id,
            season=req.season,
            espn_s2=req.espn_s2.get_secret_value() if req.espn_s2 else None,
            swid=req.swid.get_secret_value() if req.swid else None,
        )
    except espn_provider.EspnAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except espn_provider.EspnNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except espn_provider.EspnSchemaError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except espn_provider.EspnTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except espn_provider.EspnUpstreamError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    # No catch-all: exception text from arbitrary errors must not reach the
    # response, since this is the one endpoint that handles credentials.


@app.post("/api/sheet", response_model=SheetResponse)
async def generate_sheet(cfg: LeagueConfig) -> SheetResponse:
    ck = _sheet_cache_key(cfg)
    cached = cache.get(ck)
    if cached is not None:
        _backfill_cached_diagnostic_fields(cached)
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
        # Arbitrary exception text can expose paths and upstream internals —
        # full traceback goes to the logs, the client gets a generic message.
        raise HTTPException(status_code=500, detail="Sheet generation failed")

    cache.set(ck, result)
    return SheetResponse(**result)
