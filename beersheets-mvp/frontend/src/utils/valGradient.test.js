import { describe, it, expect } from 'vitest'
import { valBgStyle, psPctBgStyle } from './valGradient'

describe('valBgStyle', () => {
  it('returns {} for null value', () => {
    expect(valBgStyle(null, 0, 50, 'dark')).toEqual({})
  })

  it('returns {} for NaN value', () => {
    expect(valBgStyle(NaN, 0, 50, 'dark')).toEqual({})
  })

  it('returns {} when minValue equals maxValue', () => {
    expect(valBgStyle(10, 10, 10, 'dark')).toEqual({})
  })

  it('returns low color (blue) at t=0 for dark theme', () => {
    const style = valBgStyle(-20, -20, 100, 'dark')
    // #60a5fa → rgb(96, 165, 250)
    expect(style.backgroundColor).toBe('rgba(96, 165, 250, 0.3)')
  })

  it('returns high color (orange) at t=1 for dark theme', () => {
    const style = valBgStyle(100, -20, 100, 'dark')
    // #fb923c → rgb(251, 146, 60)
    expect(style.backgroundColor).toBe('rgba(251, 146, 60, 0.3)')
  })

  it('returns interpolated midpoint for dark theme', () => {
    const style = valBgStyle(20, -60, 100, 'dark')
    // midpoint of #60a5fa and #fb923c:
    // r: round(96 + (251-96)*0.5) = round(96+77.5) = round(173.5) = 174
    // g: round(165 + (146-165)*0.5) = round(165-9.5) = round(155.5) = 156
    // b: round(250 + (60-250)*0.5) = round(250-95) = 155
    expect(style.backgroundColor).toBe('rgba(174, 156, 155, 0.3)')
  })

  it('uses the full negative-to-positive range instead of flattening zero to blue', () => {
    expect(valBgStyle(-20, -20, 40, 'dark').backgroundColor).toBe('rgba(96, 165, 250, 0.3)')
    expect(valBgStyle(0, -20, 40, 'dark').backgroundColor).toBe('rgba(148, 159, 187, 0.3)')
  })

  it('returns low color (blue) at t=0 for macchiato theme', () => {
    const style = valBgStyle(-10, -10, 100, 'macchiato')
    // #8aadf4 → rgb(138, 173, 244)
    expect(style.backgroundColor).toBe('rgba(138, 173, 244, 0.3)')
  })

  it('returns high color (orange) at t=1 for latte theme', () => {
    const style = valBgStyle(100, -10, 100, 'latte')
    // #fe640b → rgb(254, 100, 11)
    expect(style.backgroundColor).toBe('rgba(254, 100, 11, 0.3)')
  })

  it('supports the hardcoded print theme colors', () => {
    expect(valBgStyle(-10, -10, 100, 'print', 0.25).backgroundColor).toBe('rgba(37, 99, 235, 0.25)')
    expect(valBgStyle(100, -10, 100, 'print', 0.40).backgroundColor).toBe('rgba(234, 88, 12, 0.4)')
  })

  it('clamps value below minValue to the blue endpoint', () => {
    expect(valBgStyle(-999, -10, 100, 'dark')).toEqual(valBgStyle(-10, -10, 100, 'dark'))
  })

  it('clamps value above maxValue to the orange endpoint', () => {
    expect(valBgStyle(999, -10, 50, 'dark')).toEqual(valBgStyle(50, -10, 50, 'dark'))
  })

  it('falls back to dark for unknown theme', () => {
    expect(valBgStyle(100, -10, 100, 'unknown')).toEqual(valBgStyle(100, -10, 100, 'dark'))
  })

  it('respects custom alpha', () => {
    const style = valBgStyle(-10, -10, 100, 'dark', 0.5)
    expect(style.backgroundColor).toBe('rgba(96, 165, 250, 0.5)')
  })
})

describe('psPctBgStyle', () => {
  it('returns {} for null psPct', () => {
    expect(psPctBgStyle(null, 'dark')).toEqual({})
  })

  it('is equivalent to valBgStyle with maxValue=100', () => {
    expect(psPctBgStyle(100, 'dark')).toEqual(valBgStyle(100, 0, 100, 'dark'))
    expect(psPctBgStyle(0, 'dark')).toEqual(valBgStyle(0, 0, 100, 'dark'))
    expect(psPctBgStyle(60, 'macchiato')).toEqual(valBgStyle(60, 0, 100, 'macchiato'))
  })
})
