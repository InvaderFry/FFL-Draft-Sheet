/**
 * Frontend-only domain shapes (not a 1:1 mirror of a backend model).
 *
 * These describe state the UI builds locally — drafted-pick entries, the league
 * config the form produces, and the roster-need summary the draft-strategy
 * helpers derive — and are shared across utils, hooks, and components.
 */

import type { PlayerRow } from './api'

/** The sheet's per-position player lists, keyed by position string. */
export type Positions = Record<string, PlayerRow[]>

/** Per-method tier overrides keyed by player id (sleeper_id or player_name). */
export type ManualTiers = Record<string, number>

/**
 * One entry in the drafted list. Built from synced picks or manual cross-offs;
 * newest first. `overall`/`teamId` are present only for snake-ordered sync
 * sources, which the strategy math needs to place the pick.
 */
export interface DraftedEntry {
  id: string
  name: string
  pos: string | null
  source?: string
  teamId?: string | null
  teamName?: string | null
  overall?: number | null
}

/**
 * League configuration the connect form produces. The starter-count and flex
 * fields are read by the draft-strategy helpers; the index signature keeps the
 * many other passthrough fields (season, ppr, n_teams, …) accessible.
 */
/** Per-category scoring settings. Values may be strings while typed in a form. */
export interface ScoringConfig {
  rec?: number | string
  pass_td?: number | string
  pass_yds?: number | string
  rush_td?: number | string
  rush_yds?: number | string
  rec_td?: number | string
  rec_yds?: number | string
  interception?: number | string
  fumble_lost?: number | string
  te_premium?: number | string
  [key: string]: number | string | undefined
}

export interface LeagueConfig {
  QB?: number
  RB?: number
  WR?: number
  TE?: number
  DST?: number
  flex_slots?: number
  flex_qb?: number
  season?: number | string
  scoring?: ScoringConfig | null
  [key: string]: unknown
}

/**
 * A board-row lookup entry for draft-sync matching: the minimal sheet-row
 * identity a synced pick must cross off (PlayerTable keys rows by
 * sleeper_id || player_name, captured as `id`).
 */
export interface SheetEntry {
  id: string
  name: string
  pos: string
  team: string
}

/** Manual tier boundaries: per-position arrays of player ids that start a tier. */
export type TierBoundaries = Record<string, string[]>

/** Filled-vs-needed count for a single roster slot. */
export interface SlotNeed {
  filled: number
  need: number
}

/** A bye week where two or more of the user's players are off. */
export interface ByeConflict {
  week: number
  count: number
  names: string[]
}

/** Roster-fill summary for the user's team (see rosterNeeds). */
export interface RosterNeeds {
  positions: Record<string, SlotNeed>
  flex: SlotNeed
  byeConflicts: ByeConflict[]
}

/** Whether a player is expected to survive to the user's next pick. */
export type SurvivalStatus = 'gone' | 'risky' | 'safe'
