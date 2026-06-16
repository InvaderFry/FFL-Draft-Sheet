import { describe, expect, it, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useManualTiers } from './useManualTiers'

const config = { season: 2026, scoring: { rec: 0.5 } }

const positions = {
  QB: [
    { sleeper_id: 'a', tiers: { jenks: 1 } },
    { sleeper_id: 'b', tiers: { jenks: 1 } },
    { sleeper_id: 'c', tiers: { jenks: 2 } },
  ],
}

describe('useManualTiers', () => {
  beforeEach(() => localStorage.clear())

  it('seeds boundaries from a method', () => {
    const { result } = renderHook(() => useManualTiers(config))
    expect(result.current.hasManual).toBe(false)

    act(() => result.current.seedFromMethod(positions, 'jenks'))
    expect(result.current.boundaries.QB).toEqual(['a', 'c'])
    expect(result.current.hasManual).toBe(true)
  })

  it('toggles a boundary on and off', () => {
    const { result } = renderHook(() => useManualTiers(config))
    act(() => result.current.seedFromMethod(positions, 'jenks'))

    act(() => result.current.toggleBoundary('QB', 'b'))
    expect(result.current.boundaries.QB).toContain('b')

    act(() => result.current.toggleBoundary('QB', 'b'))
    expect(result.current.boundaries.QB).not.toContain('b')
  })

  it('persists to localStorage and rehydrates per league key', () => {
    const { result, unmount } = renderHook(() => useManualTiers(config))
    act(() => result.current.seedFromMethod(positions, 'jenks'))
    unmount()

    const { result: reloaded } = renderHook(() => useManualTiers(config))
    expect(reloaded.current.boundaries.QB).toEqual(['a', 'c'])
  })

  it('keeps independent boundary sets per season/scoring', () => {
    const { result } = renderHook(() => useManualTiers(config))
    act(() => result.current.seedFromMethod(positions, 'jenks'))

    const { result: ppr } = renderHook(() => useManualTiers({ season: 2026, scoring: { rec: 1 } }))
    expect(ppr.current.hasManual).toBe(false)
  })

  it('clears all boundaries', () => {
    const { result } = renderHook(() => useManualTiers(config))
    act(() => result.current.seedFromMethod(positions, 'jenks'))
    act(() => result.current.clear())
    expect(result.current.hasManual).toBe(false)
  })
})
