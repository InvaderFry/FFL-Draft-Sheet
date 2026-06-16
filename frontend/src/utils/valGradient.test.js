import { describe, it, expect } from 'vitest'
import { valBgStyle, psPctBgStyle, valGradientPosition, valRangeFromPositions } from './valGradient'

describe('valBgStyle', () => {
  it('returns {} for null value', () => {
    expect(valBgStyle(null, 0, 50, 'mocha')).toEqual({})
  })

  it('returns {} for NaN value', () => {
    expect(valBgStyle(NaN, 0, 50, 'mocha')).toEqual({})
  })

  it('returns {} when minValue equals maxValue', () => {
    expect(valBgStyle(10, 10, 10, 'mocha')).toEqual({})
  })

  it('returns {} when range bounds are not finite', () => {
    expect(valBgStyle(10, NaN, 50, 'mocha')).toEqual({})
    expect(valBgStyle(10, 0, NaN, 'mocha')).toEqual({})
  })

  it('returns low color (blue) at t=0 for mocha theme', () => {
    const style = valBgStyle(-20, -20, 100, 'mocha')
    // #89b4fa → rgb(137, 180, 250)
    expect(style.backgroundColor).toBe('rgba(137, 180, 250, 0.3)')
  })

  it('returns high color (orange) at t=1 for mocha theme', () => {
    const style = valBgStyle(100, -20, 100, 'mocha')
    // #fab387 → rgb(250, 179, 135)
    expect(style.backgroundColor).toBe('rgba(250, 179, 135, 0.3)')
  })

  it('returns the green spectrum stop at the midpoint for mocha theme', () => {
    const style = valBgStyle(20, -60, 100, 'mocha')
    // 5 stops → t=0.5 lands exactly on the middle (green) stop #a6e3a1 → rgb(166, 227, 161)
    expect(style.backgroundColor).toBe('rgba(166, 227, 161, 0.3)')
  })

  it('uses the full negative-to-positive range instead of flattening zero to blue', () => {
    expect(valBgStyle(-20, -20, 40, 'mocha').backgroundColor).toBe('rgba(137, 180, 250, 0.3)')
    // t=1/3 → between the sky (#89dceb) and green (#a6e3a1) stops
    expect(valBgStyle(0, -20, 40, 'mocha').backgroundColor).toBe('rgba(147, 222, 210, 0.3)')
  })

  it('returns low color (blue) at t=0 for latte theme', () => {
    const style = valBgStyle(-10, -10, 100, 'latte')
    // #1e66f5 → rgb(30, 102, 245)
    expect(style.backgroundColor).toBe('rgba(30, 102, 245, 0.3)')
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
    expect(valBgStyle(-999, -10, 100, 'mocha')).toEqual(valBgStyle(-10, -10, 100, 'mocha'))
  })

  it('clamps value above maxValue to the orange endpoint', () => {
    expect(valBgStyle(999, -10, 50, 'mocha')).toEqual(valBgStyle(50, -10, 50, 'mocha'))
  })

  it('falls back to mocha for unknown theme', () => {
    expect(valBgStyle(100, -10, 100, 'unknown')).toEqual(valBgStyle(100, -10, 100, 'mocha'))
  })

  it('respects custom alpha', () => {
    const style = valBgStyle(-10, -10, 100, 'mocha', 0.5)
    expect(style.backgroundColor).toBe('rgba(137, 180, 250, 0.5)')
  })
})

describe('valGradientPosition', () => {
  it('returns the shared clamped position for gradient callers', () => {
    expect(valGradientPosition(0, -20, 40)).toBeCloseTo(1 / 3)
    expect(valGradientPosition(-999, -20, 40)).toBe(0)
    expect(valGradientPosition(999, -20, 40)).toBe(1)
  })

  it('returns null for invalid values or ranges', () => {
    expect(valGradientPosition(null, -20, 40)).toBeNull()
    expect(valGradientPosition(NaN, -20, 40)).toBeNull()
    expect(valGradientPosition(10, NaN, 40)).toBeNull()
    expect(valGradientPosition(10, -20, NaN)).toBeNull()
    expect(valGradientPosition(10, 10, 10)).toBeNull()
  })
})

describe('valRangeFromPositions', () => {
  it('uses only finite QB/RB/WR/TE values for the range', () => {
    expect(valRangeFromPositions({
      QB: [{ val: 40 }],
      RB: [{ val: null }, { val: 5 }],
      WR: [{ val: NaN }, { val: 20 }],
      TE: [{ val: 12 }],
      DST: [{ val: -50 }],
      K: [{ val: 100 }],
    })).toEqual({ minVal: 5, maxVal: 40 })
  })

  it('falls back to an empty range when no finite skill-position values exist', () => {
    expect(valRangeFromPositions({
      QB: [{ val: null }],
      RB: [{ val: NaN }],
      DST: [{ val: -50 }],
    })).toEqual({ minVal: 0, maxVal: 0 })
  })
})

describe('psPctBgStyle', () => {
  it('returns {} for null psPct', () => {
    expect(psPctBgStyle(null, 'mocha')).toEqual({})
  })

  it('is equivalent to valBgStyle with maxValue=100', () => {
    expect(psPctBgStyle(100, 'mocha')).toEqual(valBgStyle(100, 0, 100, 'mocha'))
    expect(psPctBgStyle(0, 'mocha')).toEqual(valBgStyle(0, 0, 100, 'mocha'))
    expect(psPctBgStyle(60, 'latte')).toEqual(valBgStyle(60, 0, 100, 'latte'))
  })
})
