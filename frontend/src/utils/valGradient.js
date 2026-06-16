/**
 * valGradient — spectrum background coloring for VAL and PS% cells.
 *
 * Follows the same pattern as ecrColor.js: pure functions, no React deps.
 * Each theme defines an ordered list of color stops sweeping from low (t=0)
 * to high (t=1): blue → sky → green → yellow → orange. Interpolating across
 * adjacent palette stops keeps the mid-range vivid (green/yellow) instead of
 * passing through a muddy gray when blending blue straight into orange.
 * The print theme uses hardcoded paper-safe stops.
 */

// Ordered low (t=0) → high (t=1): blue → sky → green → yellow → peach/orange
const GRADIENT_STOPS = {
  mocha: ['#89b4fa', '#89dceb', '#a6e3a1', '#f9e2af', '#fab387'], // blue, sky, green, yellow, peach
  latte: ['#1e66f5', '#04a5e5', '#40a02b', '#df8e1d', '#fe640b'], // blue, sky, green, yellow, peach
  print: ['#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c'], // paper-safe blue→cyan→green→amber→orange
}

const VAL_RANGE_POSITIONS = ['QB', 'RB', 'WR', 'TE']

function parseHex(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function interpolateHex(hexA, hexB, t) {
  const [r1, g1, b1] = parseHex(hexA)
  const [r2, g2, b2] = parseHex(hexB)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function interpolateStops(stops, t) {
  if (stops.length === 1) return stops[0]
  const scaled = t * (stops.length - 1)
  const i = Math.min(Math.floor(scaled), stops.length - 2) // clamp last segment
  return interpolateHex(stops[i], stops[i + 1], scaled - i)
}

function hexToRgba(hex, alpha) {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function isFiniteVal(value) {
  return value != null && Number.isFinite(value)
}

export function valRangeFromPositions(positions, rangePositions = VAL_RANGE_POSITIONS) {
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

export function valGradientPosition(value, minValue, maxValue) {
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
 * @param {number|null} value     - the player's VAL
 * @param {number}      minValue  - global min VAL (across all positions)
 * @param {number}      maxValue  - global max VAL (across all positions)
 * @param {string}      theme     - 'mocha' | 'latte' | 'print'
 * @param {number}      [alpha]   - opacity of the background (default 0.30)
 * @returns {{ backgroundColor: string } | {}}
 */
export function valBgStyle(value, minValue, maxValue, theme, alpha = 0.30) {
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
 * @param {number|null} psPct  - the player's PS% value (0–100)
 * @param {string}      theme  - 'mocha' | 'latte' | 'print'
 * @param {number}      [alpha]
 * @returns {{ backgroundColor: string } | {}}
 */
export function psPctBgStyle(psPct, theme, alpha = 0.30) {
  return valBgStyle(psPct, 0, 100, theme, alpha)
}
