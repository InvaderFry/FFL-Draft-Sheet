import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWatchlist } from './useWatchlist'

describe('useWatchlist', () => {
  it('toggles watched ids on and off', () => {
    const { result } = renderHook(() => useWatchlist())

    expect(result.current.count).toBe(0)
    expect(result.current.isWatched('p1')).toBe(false)

    act(() => result.current.toggle('p1'))
    expect(result.current.isWatched('p1')).toBe(true)
    expect(result.current.count).toBe(1)

    act(() => result.current.toggle('p1'))
    expect(result.current.isWatched('p1')).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('ignores falsy ids', () => {
    const { result } = renderHook(() => useWatchlist())

    act(() => result.current.toggle(''))
    act(() => result.current.toggle(null))

    expect(result.current.count).toBe(0)
  })

  it('restores persisted watchlist ids on a fresh mount', () => {
    const first = renderHook(() => useWatchlist())
    act(() => {
      first.result.current.toggle('p1')
      first.result.current.toggle('p2')
    })
    first.unmount()

    const second = renderHook(() => useWatchlist())
    expect(second.result.current.count).toBe(2)
    expect(second.result.current.isWatched('p1')).toBe(true)
    expect(second.result.current.isWatched('p2')).toBe(true)
  })
})
