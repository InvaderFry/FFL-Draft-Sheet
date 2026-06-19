/**
 * valGradient — spectrum background coloring for VAL and PS% cells.
 *
 * Follows the same pattern as ecrColor.js: pure functions, no React deps.
 * Each theme defines an ordered list of color stops sweeping from low (t=0)
 * to high (t=1): blue → green → yellow → orange. Interpolating across
 * adjacent palette stops keeps the mid-range vivid (green/yellow) instead of
 * passing through a muddy gray when blending blue straight into orange.
 * The print theme uses hardcoded paper-safe stops.
 */

import type { Positions } from '../types/domain'

/** A subset of inline-style props; empty object means "no background". */
type BgStyle = { backgroundColor?: string }

// Ordered low (t=0) → high (t=1): blue → green → yellow → peach/orange
const GRADIENT_STOPS: Record<string, string[]> = {
  mocha: ['#89b4fa', '#a6e3a1', '#f9e2af', '#fab387'], // blue, green, yellow, peach
  latte: ['#1e66f5', '#40a02b', '#df8e1d', '#fe640b'], // blue, green, yellow, peach
  print: ['#2563eb', '#16a34a', '#ca8a04', '#ea580c'], // paper-safe blue→green→amber→orange
}

const VAL_RANGE_POSITIONS = ['QB', 'RB', 'WR', 'TE']

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function interpolateHex(hexA: string, hexB: string, t: number): string {
  const [r1, g1, b1] = parseHex(hexA)
  const [r2, g2, b2] = parseHex(hexB)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function interpolateStops(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0]
  const scaled = t * (stops.length - 1)
  const i = Math.min(Math.floor(scaled), stops.length - 2) // clamp last segment
  return interpolateHex(stops[i], stops[i + 1], scaled - i)
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function isFiniteVal(value: number): boolean {
  return value != null && Number.isFinite(value)
}

export function valRangeFromPositions(
  positions: Positions | null | undefined,
  rangePositions: string[] = VAL_RANGE_POSITIONS,
): { minVal: number; maxVal: number } {
  const values = rangePositions
    .flatMap(pos => positions?.[pos] || [])
    .map(player => player.val)
    .filter(isFiniteVal)

  if (values.length === 0) return { minVal: 0, maxVal: 0 }

  return {
    minVal: Math.min(...values),
    maxVal: Math.max(...values),
  }
}

export function valGradientPosition(
  value: number | null | undefined,
  minValue: number,
  maxValue: number,
): number | null {
  if (
    value == null ||
    isNaN(value) ||
    !Number.isFinite(minValue) ||
    !Number.isFinite(maxValue) ||
    minValue === maxValue
  ) {
    return null
  }

  return Math.max(0, Math.min((value - minValue) / (maxValue - minValue), 1))
}

/**
 * Returns a backgroundColor inline style for a VAL cell.
 * Blue = low value (t→0), Orange = high value (t→1).
 *
 * @param value     the player's VAL
 * @param minValue  global min VAL (across all positions)
 * @param maxValue  global max VAL (across all positions)
 * @param theme     'mocha' | 'latte' | 'print'
 * @param alpha     opacity of the background (default 0.30)
 */
export function valBgStyle(
  value: number | null | undefined,
  minValue: number,
  maxValue: number,
  theme: string,
  alpha = 0.30,
): BgStyle {
  const t = valGradientPosition(value, minValue, maxValue)
  if (t == null) return {}
  const stops = GRADIENT_STOPS[theme] ?? GRADIENT_STOPS.mocha
  const hex = interpolateStops(stops, t)
  return { backgroundColor: hexToRgba(hex, alpha) }
}

/**
 * Returns a backgroundColor inline style for a PS% cell.
 * Scale is always fixed 0–100 (PS% is position-scoped by the backend).
 *
 * @param psPct  the player's PS% value (0–100)
 * @param theme  'mocha' | 'latte' | 'print'
 */
export function psPctBgStyle(
  psPct: number | null | undefined,
  theme: string,
  alpha = 0.30,
): BgStyle {
  return valBgStyle(psPct, 0, 100, theme, alpha)
}
