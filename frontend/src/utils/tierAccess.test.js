import { describe, expect, it } from 'vitest'
import { tierFor, methodAvailable } from './tierAccess'

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
