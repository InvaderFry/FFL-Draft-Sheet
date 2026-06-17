import { describe, it, expect } from 'vitest'
import { recommendPicks } from './recommendations'

// A sheet player. val drives the base ranking; ps_pct is a percentage (0–100);
// adp_rank feeds survival math.
const mk = (name, pos, val, extra = {}) => ({
  sleeper_id: name, player_name: name, pos, val, ps_pct: 50, adp_rank: 50, ...extra,
})

// positions map keyed by position, as the sheet provides it.
const sheet = (...players) => {
  const map = {}
  for (const p of players) (map[p.pos] ||= []).push(p)
  return map
}

const names = (recs) => recs.map(r => r.player.player_name)

describe('recommendPicks', () => {
  it('ranks by VAL when there is no roster context (best available)', () => {
    const positions = sheet(mk('A', 'RB', 30), mk('B', 'WR', 50), mk('C', 'QB', 40))
    expect(names(recommendPicks({ positions }))).toEqual(['B', 'C', 'A'])
  })

  it('excludes drafted players and below-baseline (val <= 0) players', () => {
    const positions = sheet(mk('A', 'RB', 30), mk('B', 'WR', 50), mk('C', 'QB', -5))
    const isDrafted = (id) => id === 'B'
    expect(names(recommendPicks({ positions, isDrafted }))).toEqual(['A'])
  })

  it('boosts positions the roster still needs over filled ones', () => {
    // Equal VAL; RB is filled, WR is open → WR should outrank RB.
    const positions = sheet(mk('rb', 'RB', 40), mk('wr', 'WR', 40))
    const needs = {
      positions: { RB: { filled: 2, need: 2 }, WR: { filled: 0, need: 3 } },
      flex: { filled: 1, need: 1 },
    }
    expect(names(recommendPicks({ positions, needs }))).toEqual(['wr', 'rb'])
  })

  it('raises a risky/gone player over a safe one at equal VAL', () => {
    // Both VAL 40. risky (ADP before next pick) should top safe.
    const positions = sheet(
      mk('safe', 'WR', 40, { adp_rank: 60 }),
      mk('risky', 'RB', 40, { adp_rank: 15 }),
    )
    const recs = recommendPicks({ positions, currentPick: 10, nextPick: 22 })
    expect(names(recs)).toEqual(['risky', 'safe'])
    expect(recs[0].reasons.all[0]).toBe('Likely gone by #22')
  })

  it('applies a small scarcity nudge as a position empties', () => {
    // Equal VAL; the scarcer pool (low ps_pct) edges ahead.
    const positions = sheet(
      mk('deep', 'WR', 40, { ps_pct: 90 }),
      mk('scarce', 'RB', 40, { ps_pct: 5 }),
    )
    expect(names(recommendPicks({ positions }))[0]).toBe('scarce')
  })

  it('caps recommendations per position for variety', () => {
    const positions = sheet(
      mk('rb1', 'RB', 60), mk('rb2', 'RB', 58), mk('rb3', 'RB', 56),
      mk('rb4', 'RB', 54), mk('wr1', 'WR', 30),
    )
    const recs = recommendPicks({ positions, maxPerPosition: 3 })
    expect(recs.filter(r => r.player.pos === 'RB')).toHaveLength(3)
    expect(names(recs)).toContain('wr1')
  })

  it('respects the limit', () => {
    const positions = sheet(
      mk('a', 'RB', 60), mk('b', 'WR', 58), mk('c', 'QB', 56),
      mk('d', 'TE', 54), mk('e', 'DST', 52),
    )
    expect(recommendPicks({ positions, limit: 2 })).toHaveLength(2)
  })

  it('falls back to a value reason when nothing else stands out', () => {
    const positions = sheet(mk('A', 'RB', 33, { ps_pct: 80 }))
    const recs = recommendPicks({ positions })
    expect(recs[0].reasons.primary).toBe('Top value (VAL 33)')
  })

  it('returns an empty list for a missing sheet', () => {
    expect(recommendPicks({ positions: null })).toEqual([])
  })
})
