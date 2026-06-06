import { describe, it, expect } from 'vitest'
import { valBgStyle, psPctBgStyle } from './valGradient'

describe('valBgStyle', () => {
  it('returns {} for null value', () => {
    expect(valBgStyle(null, 50, 'dark')).toEqual({})
  })

  it('returns {} for NaN value', () => {
    expect(valBgStyle(NaN, 50, 'dark')).toEqual({})
  })

  it('returns {} when maxValue is 0', () => {
    expect(valBgStyle(10, 0, 'dark')).toEqual({})
  })

  it('returns {} when maxValue is negative', () => {
    expect(valBgStyle(10, -5, 'dark')).toEqual({})
  })

  it('returns low color (blue) at t=0 for dark theme', () => {
    const style = valBgStyle(0, 100, 'dark')
    // #60a5fa → rgb(96, 165, 250)
    expect(style.backgroundColor).toBe('rgba(96, 165, 250, 0.3)')
  })

  it('returns high color (orange) at t=1 for dark theme', () => {
    const style = valBgStyle(100, 100, 'dark')
    // #fb923c → rgb(251, 146, 60)
    expect(style.backgroundColor).toBe('rgba(251, 146, 60, 0.3)')
  })

  it('returns interpolated midpoint for dark theme', () => {
    const style = valBgStyle(50, 100, 'dark')
    // midpoint of #60a5fa and #fb923c:
    // r: round(96 + (251-96)*0.5) = round(96+77.5) = round(173.5) = 174
    // g: round(165 + (146-165)*0.5) = round(165-9.5) = round(155.5) = 156
    // b: round(250 + (60-250)*0.5) = round(250-95) = 155
    expect(style.backgroundColor).toBe('rgba(174, 156, 155, 0.3)')
  })

  it('returns low color (blue) at t=0 for macchiato theme', () => {
    const style = valBgStyle(0, 100, 'macchiato')
    // #8aadf4 → rgb(138, 173, 244)
    expect(style.backgroundColor).toBe('rgba(138, 173, 244, 0.3)')
  })

  it('returns high color (orange) at t=1 for latte theme', () => {
    const style = valBgStyle(100, 100, 'latte')
    // #fe640b → rgb(254, 100, 11)
    expect(style.backgroundColor).toBe('rgba(254, 100, 11, 0.3)')
  })

  it('clamps negative value to 0 (blue endpoint)', () => {
    expect(valBgStyle(-10, 100, 'dark')).toEqual(valBgStyle(0, 100, 'dark'))
  })

  it('clamps value above maxValue to maxValue (orange endpoint)', () => {
    expect(valBgStyle(999, 50, 'dark')).toEqual(valBgStyle(50, 50, 'dark'))
  })

  it('falls back to dark for unknown theme', () => {
    expect(valBgStyle(100, 100, 'unknown')).toEqual(valBgStyle(100, 100, 'dark'))
  })

  it('respects custom alpha', () => {
    const style = valBgStyle(0, 100, 'dark', 0.5)
    expect(style.backgroundColor).toBe('rgba(96, 165, 250, 0.5)')
  })
})

describe('psPctBgStyle', () => {
  it('returns {} for null psPct', () => {
    expect(psPctBgStyle(null, 'dark')).toEqual({})
  })

  it('is equivalent to valBgStyle with maxValue=100', () => {
    expect(psPctBgStyle(100, 'dark')).toEqual(valBgStyle(100, 100, 'dark'))
    expect(psPctBgStyle(0, 'dark')).toEqual(valBgStyle(0, 100, 'dark'))
    expect(psPctBgStyle(60, 'macchiato')).toEqual(valBgStyle(60, 100, 'macchiato'))
  })
})
