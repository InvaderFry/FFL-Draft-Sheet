/**
 * In-draft strategy math — pure, side-effect-free helpers shared by the board
 * and drafted panel. Tested in draftStrategy.test.js.
 *
 * All of this is derived from data already on the board: synced pick entries
 * ({id, name, pos, teamId, overall}), the user's team id, the league config,
 * and per-player ADP. Snake-draft order is the backbone: an overall pick
 * number maps to a (round, slot) and back.
 */

import type {
  ByeConflict,
  DraftedEntry,
  LeagueConfig,
  RosterNeeds,
  SlotNeed,
  SurvivalStatus,
} from '../types/domain'

export const STARTER_POS = ['QB', 'RB', 'WR', 'TE', 'DST']

/** 1..nTeams draft slot that owns a given overall pick in a snake draft. */
function slotOfOverall(overall: number, nTeams: number): number {
  const idx = (overall - 1) % nTeams // 0-based position within the round
  const round = Math.floor((overall - 1) / nTeams) + 1
  // Odd rounds run 1..n; even rounds snake back n..1.
  return round % 2 === 1 ? idx + 1 : nTeams - idx
}

/** Overall pick number a slot holds in a given round (snake). */
function overallOf(slot: number, round: number, nTeams: number): number {
  return round % 2 === 1
    ? (round - 1) * nTeams + slot
    : (round - 1) * nTeams + (nTeams - slot + 1)
}

/** Highest overall pick seen so far across all teams (the draft's progress). */
export function currentOverall(draftedList: DraftedEntry[]): number {
  return draftedList.reduce((m, p) => Math.max(m, p.overall || 0), 0)
}

/**
 * Infer the user's draft slot from their earliest synced pick. Returns null
 * until they've made a pick (or no team is selected).
 */
export function inferMySlot(
  draftedList: DraftedEntry[],
  myTeamId: string | null | undefined,
  nTeams: number,
): number | null {
  if (!myTeamId || !nTeams) return null
  const mine = draftedList.filter(p => p.teamId === myTeamId && p.overall)
  if (mine.length === 0) return null
  const earliest = mine.reduce((a, b) => ((a.overall ?? 0) <= (b.overall ?? 0) ? a : b))
  return slotOfOverall(earliest.overall ?? 0, nTeams)
}

/**
 * The user's next overall pick number, strictly after the current draft
 * progress. Null when the slot can't be inferred yet.
 */
export function nextUserPickOverall(
  draftedList: DraftedEntry[],
  myTeamId: string | null | undefined,
  nTeams: number,
): number | null {
  const slot = inferMySlot(draftedList, myTeamId, nTeams)
  if (!slot) return null
  const cur = currentOverall(draftedList)
  const maxRounds = Math.ceil((cur + 1) / nTeams) + 40 // cap; drafts aren't 40+ rounds
  for (let r = 1; r <= maxRounds; r++) {
    const o = overallOf(slot, r, nTeams)
    if (o > cur) return o
  }
  return null
}

/**
 * Will a player likely survive to the user's next pick, by ADP?
 *   'gone'  — ADP says already off the board
 *   'risky' — likely drafted before you pick again
 *   'safe'  — ADP clears your next pick
 *   null    — no ADP, or next pick unknown
 */
export function survivalStatus(
  adpRank: number | null | undefined,
  cur: number | null | undefined,
  nextPick: number | null | undefined,
): SurvivalStatus | null {
  if (adpRank == null || nextPick == null) return null
  const current = cur ?? 0
  if (adpRank <= current) return 'gone'
  if (adpRank <= nextPick) return 'risky'
  return 'safe'
}

/**
 * Count picks by position made since the user's last pick — the signal behind
 * a "4 RBs off the board" run alert. With no user picks yet, counts from the
 * draft's start.
 */
export function positionRunsSinceLastPick(
  draftedList: DraftedEntry[],
  myTeamId: string | null | undefined,
  _nTeams: number,
  positions: string[] = STARTER_POS,
): Record<string, number> {
  const mine = myTeamId ? draftedList.filter(p => p.teamId === myTeamId && p.overall) : []
  const lastMine = mine.reduce((m, p) => Math.max(m, p.overall ?? 0), 0)
  const runs: Record<string, number> = {}
  for (const pos of positions) runs[pos] = 0
  for (const p of draftedList) {
    if (!p.overall || p.overall <= lastMine) continue
    if (p.pos && runs[p.pos] != null) runs[p.pos] += 1
  }
  return runs
}

/**
 * Roster fill status for the user's team: dedicated starter slots filled vs
 * needed per position, a FLEX line, and bye-week conflicts (weeks where ≥2 of
 * the user's players are off). byeOf(id) resolves a pick's bye via the sheet.
 */
export function rosterNeeds(
  myPicks: DraftedEntry[],
  config: LeagueConfig | null | undefined,
  byeOf: (id: string) => number | null = () => null,
): RosterNeeds {
  const flexSlots = Number(config?.flex_slots || 0)
  const superflex = Number(config?.flex_qb || 0) > 0

  const have: Record<string, number> = {}
  for (const pos of STARTER_POS) have[pos] = 0
  for (const p of myPicks) if (p.pos && have[p.pos] != null) have[p.pos] += 1

  const positions: Record<string, SlotNeed> = {}
  let flexLeftovers = 0
  for (const pos of STARTER_POS) {
    const need = Number(config?.[pos] || 0)
    positions[pos] = { filled: Math.min(have[pos], need), need }
    const surplus = Math.max(0, have[pos] - need)
    if (pos === 'RB' || pos === 'WR' || pos === 'TE' || (pos === 'QB' && superflex)) {
      flexLeftovers += surplus
    }
  }
  const flex: SlotNeed = { filled: Math.min(flexSlots, flexLeftovers), need: flexSlots }

  const byWeek = new Map<number, string[]>()
  for (const p of myPicks) {
    const bye = byeOf(p.id)
    if (!bye) continue
    if (!byWeek.has(bye)) byWeek.set(bye, [])
    byWeek.get(bye)!.push(p.name)
  }
  const byeConflicts: ByeConflict[] = [...byWeek.entries()]
    .filter(([, names]) => names.length >= 2)
    .map(([week, names]) => ({ week, count: names.length, names }))
    .sort((a, b) => a.week - b.week)

  return { positions, flex, byeConflicts }
}
