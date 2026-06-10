import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraftState } from './useDraftState'

describe('useDraftState', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useDraftState())
    expect(result.current.count).toBe(0)
    expect(result.current.isDrafted('x')).toBe(false)
  })

  it('toggles a player on and off', () => {
    const { result } = renderHook(() => useDraftState())

    act(() => result.current.toggle('p1'))
    expect(result.current.isDrafted('p1')).toBe(true)
    expect(result.current.count).toBe(1)

    act(() => result.current.toggle('p1'))
    expect(result.current.isDrafted('p1')).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('ignores falsy ids', () => {
    const { result } = renderHook(() => useDraftState())
    act(() => result.current.toggle(''))
    act(() => result.current.toggle(null))
    expect(result.current.count).toBe(0)
  })

  it('tracks multiple players and clears them all', () => {
    const { result } = renderHook(() => useDraftState())
    act(() => {
      result.current.toggle('a')
      result.current.toggle('b')
      result.current.toggle('c')
    })
    expect(result.current.count).toBe(3)

    act(() => result.current.clear())
    expect(result.current.count).toBe(0)
    expect(result.current.isDrafted('a')).toBe(false)
  })

  describe('applySyncedPicks', () => {
    const pick = (id, overall, teamId = 't1') => ({
      id, name: `Player ${id}`, pos: 'RB', teamId, teamName: 'Team One', overall,
    })

    it('adds synced picks newest-first with espn source', () => {
      const { result } = renderHook(() => useDraftState())
      act(() => result.current.applySyncedPicks([pick('a', 1), pick('b', 2)]))

      expect(result.current.count).toBe(2)
      expect(result.current.draftedList[0]).toMatchObject({ id: 'b', source: 'espn', overall: 2 })
      expect(result.current.draftedList[1]).toMatchObject({ id: 'a', source: 'espn', overall: 1 })
      expect(result.current.isDrafted('a')).toBe(true)
    })

    it('is idempotent — same payload twice keeps the same list reference', () => {
      const { result } = renderHook(() => useDraftState())
      const picks = [pick('a', 1), pick('b', 2)]
      act(() => result.current.applySyncedPicks(picks))
      const before = result.current.draftedList
      act(() => result.current.applySyncedPicks(picks))
      expect(result.current.draftedList).toBe(before)
    })

    it('promotes a manual entry when ESPN confirms the pick', () => {
      const { result } = renderHook(() => useDraftState())
      act(() => result.current.toggle('a', 'Player a', 'RB'))
      expect(result.current.draftedList[0].source).toBe('manual')

      act(() => result.current.applySyncedPicks([pick('a', 1)]))
      expect(result.current.count).toBe(1)
      expect(result.current.draftedList[0]).toMatchObject({ id: 'a', source: 'espn', teamId: 't1' })
    })

    it('keeps manual entries below synced picks', () => {
      const { result } = renderHook(() => useDraftState())
      act(() => result.current.toggle('manual1', 'Manual Guy', 'WR'))
      act(() => result.current.applySyncedPicks([pick('a', 1)]))

      expect(result.current.draftedList.map(p => p.id)).toEqual(['a', 'manual1'])
      expect(result.current.isDrafted('manual1')).toBe(true)
    })
  })

  it('toggle is a no-op on espn-synced entries', () => {
    const { result } = renderHook(() => useDraftState())
    act(() => result.current.applySyncedPicks([
      { id: 'a', name: 'Player a', pos: 'RB', teamId: 't1', teamName: 'T', overall: 1 },
    ]))

    act(() => result.current.toggle('a', 'Player a', 'RB'))
    expect(result.current.isDrafted('a')).toBe(true)
    expect(result.current.draftedList[0].source).toBe('espn')
  })
})
