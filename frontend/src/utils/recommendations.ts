/**
 * Best-pick recommendation engine — "who do I draft now?"
 *
 * Pure, side-effect-free composition of signals the sheet already computes:
 * VAL (value over baseline, the cross-positional VBD currency), PS% (positional
 * scarcity), roster needs, and per-player survivability. No new data — this just
 * ranks available players the way a draft assistant would.
 *
 * VBD value is comparable across positions by design, so VAL is the backbone
 * (best-player-available). Need, survival urgency, and scarcity tilt it.
 *
 * Tested in recommendations.test.js.
 */

import type { PlayerRow } from '../types/api'
import type { LeagueConfig, Positions, RosterNeeds } from '../types/domain'
import { STARTER_POS, survivalStatus } from './draftStrategy'

interface ReasonCtx {
  needs: RosterNeeds | null
  currentPick: number | null
  nextPick: number | null
  superflex: boolean
}

interface Reasons {
  primary: string
  all: string[]
}

interface RecommendArgs {
  positions: Positions | null | undefined
  isDrafted?: (id: string) => boolean
  needs?: RosterNeeds | null
  currentPick?: number | null
  nextPick?: number | null
  config?: LeagueConfig | null
  limit?: number
  maxPerPosition?: number
}

export interface Recommendation {
  player: PlayerRow
  score: number
  reasons: Reasons
}

// Tunable weights. Multiplicative so each factor is an interpretable nudge on
// the player's base VAL.
export const WEIGHTS = {
  needStarter: 1.25, // open dedicated starter slot at this position
  needFlex: 1.1, // position full, but a flex slot it can fill is open
  needFilled: 0.75, // position (and any flex it feeds) already satisfied
  urgentRisky: 1.2, // ADP says likely gone before your next pick ('risky'/'gone')
  urgentSafe: 0.9, // clears your next pick — you can wait
  scarcityMax: 0.15, // max scarcity boost as a position's value pool empties
}

const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE'])

function flexEligible(pos: string, superflex: boolean): boolean {
  return FLEX_ELIGIBLE.has(pos) || (pos === 'QB' && superflex)
}

/**
 * Need factor for a position given the user's roster needs. 1.0 when there's no
 * roster context yet (best-player-available mode).
 */
function needFactor(pos: string, needs: RosterNeeds | null, superflex: boolean): number {
  if (!needs) return 1.0
  const slot = needs.positions?.[pos]
  if (slot && slot.filled < slot.need) return WEIGHTS.needStarter
  const flex = needs.flex
  if (flex && flex.filled < flex.need && flexEligible(pos, superflex)) {
    return WEIGHTS.needFlex
  }
  return WEIGHTS.needFilled
}

/** Survival urgency factor. 1.0 when the next pick / ADP is unknown. */
function urgencyFactor(
  adpRank: number | null | undefined,
  currentPick: number | null,
  nextPick: number | null,
): number {
  const status = survivalStatus(adpRank, currentPick, nextPick)
  if (status === 'risky' || status === 'gone') return WEIGHTS.urgentRisky
  if (status === 'safe') return WEIGHTS.urgentSafe
  return 1.0
}

/** Small scarcity nudge: up to +scarcityMax as the position's value empties. */
function scarcityFactor(psPct: number | null | undefined): number {
  const pct = Number(psPct) || 0
  return 1 + (1 - pct / 100) * WEIGHTS.scarcityMax
}

/**
 * Human-readable "why" for a recommendation. Returns { primary, all } — primary
 * drives the compact subtitle, all the full tooltip. Priority: urgency, then
 * need, then scarcity, then raw value.
 */
function buildReasons(player: PlayerRow, ctx: ReasonCtx): Reasons {
  const { needs, currentPick, nextPick, superflex } = ctx
  const all: string[] = []

  const status = survivalStatus(player.adp_rank, currentPick, nextPick)
  if (status === 'risky') all.push(`Likely gone by #${nextPick}`)
  else if (status === 'gone') all.push(`Going now (ADP ${player.adp_rank})`)

  const slot = needs?.positions?.[player.pos]
  if (slot && slot.filled < slot.need) {
    all.push(`Fills ${player.pos} need (${slot.filled}/${slot.need})`)
  } else if (
    needs?.flex &&
    needs.flex.filled < needs.flex.need &&
    flexEligible(player.pos, superflex)
  ) {
    all.push(`Fills FLEX (${needs.flex.filled}/${needs.flex.need})`)
  }

  const pct = Number(player.ps_pct) || 0
  if (pct <= 25) all.push(`${player.pos} scarce — ${Math.round(pct)}% left`)

  if (all.length === 0) all.push(`Top value (VAL ${Math.round(player.val)})`)

  return { primary: all[0], all }
}

/**
 * Rank available players into recommended picks.
 *
 * @param args.positions      sheet positions map ({ RB: [...], ... })
 * @param args.isDrafted      (id) => bool, drafted players are excluded
 * @param args.needs          rosterNeeds() output; null = BPA mode
 * @param args.currentPick    draft progress (snake-live only)
 * @param args.nextPick       user's next overall pick (snake-live only)
 * @param args.config         league config (reads flex_qb for superflex)
 * @param args.limit          how many to return (default 6)
 * @param args.maxPerPosition cap per position for variety (default 3)
 */
export function recommendPicks({
  positions,
  isDrafted = () => false,
  needs = null,
  currentPick = null,
  nextPick = null,
  config = null,
  limit = 6,
  maxPerPosition = 3,
}: RecommendArgs): Recommendation[] {
  if (!positions) return []
  const superflex = Number(config?.flex_qb || 0) > 0

  const scored: { player: PlayerRow; score: number }[] = []
  for (const pos of STARTER_POS) {
    const players = positions[pos] || []
    for (const player of players) {
      const id = player.sleeper_id || player.player_name
      if (isDrafted(id)) continue
      // Recommendations are top-of-board only; below-baseline players never
      // surface, and skipping them avoids multiplicative weirdness on negatives.
      if (!(player.val > 0)) continue

      const score =
        player.val *
        needFactor(pos, needs, superflex) *
        urgencyFactor(player.adp_rank, currentPick, nextPick) *
        scarcityFactor(player.ps_pct)

      scored.push({ player, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  const perPos: Record<string, number> = {}
  const ctx: ReasonCtx = { needs, currentPick, nextPick, superflex }
  const out: Recommendation[] = []
  for (const entry of scored) {
    const pos = entry.player.pos
    if ((perPos[pos] || 0) >= maxPerPosition) continue
    perPos[pos] = (perPos[pos] || 0) + 1
    out.push({ ...entry, reasons: buildReasons(entry.player, ctx) })
    if (out.length >= limit) break
  }

  return out
}
