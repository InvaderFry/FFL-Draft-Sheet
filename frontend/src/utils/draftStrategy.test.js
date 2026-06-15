import { describe, it, expect } from 'vitest'
import {
  currentOverall,
  inferMySlot,
  nextUserPickOverall,
  survivalStatus,
  positionRunsSinceLastPick,
  rosterNeeds,
} from './draftStrategy'

// Build a synced pick. overall drives snake math; teamId attributes ownership.
const pick = (overall, pos, teamId, extra = {}) => ({
  id: `p${overall}`, name: `Player ${overall}`, pos, teamId, overall, source: 'espn', ...extra,
})

// A 12-team snake: slot 3 picks at overall 3, 22 (round 2 reversed), 27, 46, ...
const N = 12

describe('snake draft math', () => {
  it('infers the user slot from the earliest pick in an odd round', () => {
    const list = [pick(3, 'RB', 'me'), pick(27, 'WR', 'me')]
    expect(inferMySlot(list, 'me', N)).toBe(3)
  })

  it('infers the slot from a pick made in an even (reversed) round', () => {
    // Only an even-round pick available: slot 3 owns overall 22 in round 2.
    expect(inferMySlot([pick(22, 'RB', 'me')], 'me', N)).toBe(3)
  })

  it('returns null before the user has any pick', () => {
    expect(inferMySlot([pick(1, 'RB', 'other')], 'me', N)).toBeNull()
    expect(inferMySlot([], 'me', N)).toBeNull()
  })

  it('currentOverall is the deepest pick made', () => {
    expect(currentOverall([pick(3, 'RB', 'me'), pick(7, 'WR', 'x')])).toBe(7)
    expect(currentOverall([])).toBe(0)
  })

  it('computes the next user pick across the snake turn', () => {
    // Slot 3, picked at 3; draft is now at overall 10 → next pick is 22.
    const list = [pick(3, 'RB', 'me'), ...Array.from({ length: 7 }, (_, i) => pick(4 + i, 'WR', 'x'))]
    expect(currentOverall(list)).toBe(10)
    expect(nextUserPickOverall(list, 'me', N)).toBe(22)
  })

  it('next pick is null when the slot is unknown', () => {
    expect(nextUserPickOverall([pick(5, 'RB', 'other')], 'me', N)).toBeNull()
  })
})

describe('survivalStatus', () => {
  it('classifies relative to the current and next pick', () => {
    expect(survivalStatus(8, 10, 22)).toBe('gone')   // already past per ADP
    expect(survivalStatus(15, 10, 22)).toBe('risky') // gone before your pick 22
    expect(survivalStatus(30, 10, 22)).toBe('safe')  // clears your next pick
    expect(survivalStatus(22, 10, 22)).toBe('risky') // boundary is inclusive
  })

  it('is null without ADP or a known next pick', () => {
    expect(survivalStatus(null, 10, 22)).toBeNull()
    expect(survivalStatus(15, 10, null)).toBeNull()
  })
})

describe('positionRunsSinceLastPick', () => {
  it('counts picks by position made after the user last picked', () => {
    const list = [
      pick(3, 'RB', 'me'),
      pick(4, 'RB', 'x'), pick(5, 'WR', 'y'), pick(6, 'RB', 'z'), pick(7, 'QB', 'x'),
    ]
    const runs = positionRunsSinceLastPick(list, 'me', N)
    expect(runs.RB).toBe(2)
    expect(runs.WR).toBe(1)
    expect(runs.QB).toBe(1)
    expect(runs.TE).toBe(0)
  })

  it('counts from the draft start when the user has no pick yet', () => {
    const list = [pick(1, 'RB', 'x'), pick(2, 'RB', 'y')]
    expect(positionRunsSinceLastPick(list, 'me', N).RB).toBe(2)
  })
})

describe('rosterNeeds', () => {
  const config = { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1, flex_slots: 1, flex_qb: 0 }

  it('reports filled vs need per starter position and a flex line', () => {
    const myPicks = [pick(3, 'RB', 'me'), pick(22, 'RB', 'me'), pick(27, 'RB', 'me')]
    const r = rosterNeeds(myPicks, config)
    expect(r.positions.RB).toEqual({ filled: 2, need: 2 })
    expect(r.positions.WR).toEqual({ filled: 0, need: 3 })
    // Third RB is surplus → fills the single flex slot.
    expect(r.flex).toEqual({ filled: 1, need: 1 })
  })

  it('only counts QB surplus toward flex in superflex leagues', () => {
    const sf = { ...config, flex_qb: 1 }
    const twoQb = [pick(3, 'QB', 'me'), pick(22, 'QB', 'me')]
    expect(rosterNeeds(twoQb, config).flex.filled).toBe(0) // standard: QB not flex-eligible
    expect(rosterNeeds(twoQb, sf).flex.filled).toBe(1)     // superflex: surplus QB fills flex
  })

  it('flags bye-week conflicts among the user picks', () => {
    const byes = { p3: 9, p22: 9, p27: 6 }
    const myPicks = [pick(3, 'RB', 'me'), pick(22, 'WR', 'me'), pick(27, 'WR', 'me')]
    const r = rosterNeeds(myPicks, config, id => byes[id])
    expect(r.byeConflicts).toEqual([{ week: 9, count: 2, names: ['Player 3', 'Player 22'] }])
  })
})
