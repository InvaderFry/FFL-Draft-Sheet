/**
 * Frontend mirror of the backend's request/response contract.
 *
 * SOURCE OF TRUTH: these interfaces mirror the Pydantic models in
 *   - backend/app/main.py        (PlayerRow, Sheet*, *DraftRequest)
 *   - backend/app/providers/base.py (DraftStatus, DraftPick, DraftTeam)
 * When a backend model changes, update the matching interface here. Python
 * `X | None` maps to `X | null`; `dict[str, V]` maps to `Record<string, V>`.
 */

// --------------------------------------------------------------------------- //
// Sheet response (POST /api/sheet) — backend/app/main.py
// --------------------------------------------------------------------------- //

/** One player row in a generated draft sheet. Mirrors main.py::PlayerRow. */
export interface PlayerRow {
  sleeper_id: string | null
  espn_id: string | null
  player_name: string
  pos: string
  team: string
  bye_week: number | null
  mean_pts: number
  baseline: number
  val: number
  floor: number
  ceil: number
  ps_pct: number
  n_sources: number
  pos_rank: number
  adp_rank: number | null
  ecr_rank: number | null
  ecr_fmt: string
  tier: number
  tier_is_even: boolean
  /** Per-method tier assignments, keyed by method name. */
  tiers: Record<string, number>
  auction_price: number | null
}

/** Mirrors main.py::SourceFailure. */
export interface SourceFailure {
  position: string
  reason: string
}

/** Mirrors main.py::SourceStatus. */
export interface SourceStatus {
  source: string
  status: string
  used: boolean
  positions: string[]
  position_counts: Record<string, number>
  reason: string | null
  failures: SourceFailure[]
}

/** Mirrors main.py::SheetMetadata. */
export interface SheetMetadata {
  season: number
  n_teams: number
  ppr: number
  sources_used: string[]
  sources_dropped: string[]
  source_statuses: SourceStatus[]
  baselines: Record<string, number>
  data_quality_warnings: string[]
  adp_available: boolean
  ecr_available: boolean
  adp_season: number | null
  cache_hit: boolean
  generation_time_s: number
}

/** Mirrors main.py::SheetResponse. Positions keyed by position string. */
export interface SheetResponse {
  positions: Record<string, PlayerRow[]>
  metadata: SheetMetadata
}

// --------------------------------------------------------------------------- //
// Draft sync (POST /api/draft/espn|sleeper) — backend/app/providers/base.py
// --------------------------------------------------------------------------- //

/** A single drafted pick. Mirrors base.py::DraftPick. */
export interface DraftPick {
  overall: number
  round: number | null
  round_pick: number | null
  team_id: string
  provider_player_id: string
  sleeper_id: string | null
  player_name: string | null
  pos: string | null
  nfl_team: string | null
}

/** A draft-room team. Mirrors base.py::DraftTeam. */
export interface DraftTeam {
  team_id: string
  name: string
  abbrev: string | null
}

/** Normalized draft-room state returned by the sync endpoints. Mirrors
 * base.py::DraftStatus. */
export interface DraftStatus {
  provider: string
  in_progress: boolean
  complete: boolean
  picks: DraftPick[]
  teams: DraftTeam[]
  my_team_id: string | null
  /** Unix timestamp; lets the UI show "synced Xs ago". */
  fetched_at: number
}

// --------------------------------------------------------------------------- //
// Request bodies (built in src/api.ts)
// --------------------------------------------------------------------------- //

/** POST body for /api/draft/espn. Mirrors main.py::EspnDraftRequest. */
export interface EspnDraftBody {
  league_id: number
  season: number
  espn_s2: string | null
  swid: string | null
  mock_ingest: boolean
}

/** POST body for /api/draft/sleeper. Mirrors main.py::SleeperDraftRequest. */
export interface SleeperDraftBody {
  draft_id: string
}

// --------------------------------------------------------------------------- //
// Client-side helper shapes
// --------------------------------------------------------------------------- //

/**
 * Result of a one-shot connection pre-flight (see src/api.ts). `status` is the
 * HTTP status, or 0 when the backend was unreachable.
 */
export interface ConnectionResult {
  ok: boolean
  status: number
  detail: string
}

/**
 * The connect-form settings object the request builders read from. Fields are
 * a superset across providers; each builder reads only what it needs.
 */
export interface DraftSettings {
  leagueId?: string | number
  season?: string | number
  espn_s2?: string | null
  swid?: string | null
  mock?: boolean
  draftId?: string
}
