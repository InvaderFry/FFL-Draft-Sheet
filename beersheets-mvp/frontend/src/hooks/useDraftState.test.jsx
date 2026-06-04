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
})
