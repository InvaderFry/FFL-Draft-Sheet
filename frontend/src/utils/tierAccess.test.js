import { describe, expect, it } from 'vitest'
import { tierFor, tierNumberMethod, methodAvailable, computeBoundaries, deriveManualTiers } from './tierAccess'

const player = (overrides = {}) => ({
  player_name: 'Test Player',
  sleeper_id: 'test-player',
  tier: 3,
  tiers: { jenks: 3, gmm: 5 },
  ...overrides,
})

describe('tierFor', () => {
  it('returns the method-specific tier from the tiers map', () => {
    expect(tierFor(player(), 'jenks')).toBe(3)
    expect(tierFor(player(), 'gmm')).toBe(5)
  })

  it('falls back to the flat tier for jenks on legacy payloads', () => {
    expect(tierFor({ tier: 7 }, 'jenks')).toBe(7)
  })

  it('returns null for an absent non-jenks method', () => {
    expect(tierFor(player(), 'boris_chen')).toBeNull()
  })

  it('reads manual tiers from the override map by player id', () => {
    expect(tierFor(player(), 'manual', { 'test-player': 2 })).toBe(2)
    expect(tierFor(player(), 'manual', null)).toBeNull()
  })

  it('returns null for none / missing inputs', () => {
    expect(tierFor(player(), 'none')).toBeNull()
    expect(tierFor(null, 'jenks')).toBeNull()
  })
})

describe('tierNumberMethod', () => {
  it('uses the Lines method when one is selected', () => {
    expect(tierNumberMethod('jenks', 'gmm')).toBe('gmm')
  })

  it('falls back to the Shade method when Lines is none/empty', () => {
    expect(tierNumberMethod('jenks', 'none')).toBe('jenks')
    expect(tierNumberMethod('gmm', '')).toBe('gmm')
  })
})

describe('methodAvailable', () => {
  const positions = {
    QB: [{ tiers: { jenks: 1, gmm: 1 } }],
    RB: [{ tiers: { jenks: 2, gmm: 2, boris_chen: 1 } }],
  }

  it('treats jenks and none as always available', () => {
    expect(methodAvailable({}, 'jenks')).toBe(true)
    expect(methodAvailable({}, 'none')).toBe(true)
  })

  it('detects a method present on any player', () => {
    expect(methodAvailable(positions, 'gmm')).toBe(true)
    expect(methodAvailable(positions, 'boris_chen')).toBe(true)
  })

  it('reports an absent method as unavailable', () => {
    expect(methodAvailable({ QB: [{ tiers: { jenks: 1 } }] }, 'boris_chen')).toBe(false)
  })

  it('treats manual as available only once seeded', () => {
    expect(methodAvailable(positions, 'manual', null)).toBe(false)
    expect(methodAvailable(positions, 'manual', { x: 1 })).toBe(true)
  })
})

describe('computeBoundaries', () => {
  const positions = {
    QB: [
      { sleeper_id: 'a', tiers: { jenks: 1 } },
      { sleeper_id: 'b', tiers: { jenks: 1 } },
      { sleeper_id: 'c', tiers: { jenks: 2 } },
      { sleeper_id: 'd', tiers: { jenks: 3 } },
    ],
  }

  it('marks the first player and every tier change as a boundary', () => {
    expect(computeBoundaries(positions, 'jenks').QB).toEqual(['a', 'c', 'd'])
  })
})

describe('deriveManualTiers', () => {
  const positions = {
    QB: [
      { sleeper_id: 'a' },
      { sleeper_id: 'b' },
      { sleeper_id: 'c' },
      { sleeper_id: 'd' },
    ],
  }

  it('renumbers contiguously from the boundary id set', () => {
    const map = deriveManualTiers(positions, { QB: ['a', 'c'] })
    expect(map).toEqual({ a: 1, b: 1, c: 2, d: 2 })
  })

  it('always starts the first player at tier 1 even without an explicit boundary', () => {
    const map = deriveManualTiers(positions, { QB: ['c'] })
    expect(map).toEqual({ a: 1, b: 1, c: 2, d: 2 })
  })

  it('round-trips with computeBoundaries to reproduce a method', () => {
    const withTiers = {
      QB: [
        { sleeper_id: 'a', tiers: { gmm: 1 } },
        { sleeper_id: 'b', tiers: { gmm: 2 } },
        { sleeper_id: 'c', tiers: { gmm: 2 } },
      ],
    }
    const boundaries = computeBoundaries(withTiers, 'gmm')
    const map = deriveManualTiers(withTiers, boundaries)
    expect(map).toEqual({ a: 1, b: 2, c: 2 })
  })
})
