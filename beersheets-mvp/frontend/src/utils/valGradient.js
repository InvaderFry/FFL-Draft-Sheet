/**
 * valGradient — blue→orange background coloring for VAL and PS% cells.
 *
 * Follows the same pattern as ecrColor.js: pure functions, no React deps.
 * Colors match the existing --c-ecr-blue / --c-ecr-orange CSS variables
 * for each theme, using Catppuccin palette for macchiato/latte.
 * The print theme uses hardcoded paper-safe blue/orange endpoints.
 */

const GRADIENT_COLORS = {
  dark:      { low: '#60a5fa', high: '#fb923c' },
  macchiato: { low: '#8aadf4', high: '#f5a97f' },
  latte:     { low: '#1e66f5', high: '#fe640b' },
  print:     { low: '#2563eb', high: '#ea580c' },
}

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

function hexToRgba(hex, alpha) {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Returns a backgroundColor inline style for a VAL cell.
 * Blue = low value (t→0), Orange = high value (t→1).
 *
 * @param {number|null} value     - the player's VAL
 * @param {number}      minValue  - global min VAL (across all positions)
 * @param {number}      maxValue  - global max VAL (across all positions)
 * @param {string}      theme     - 'dark' | 'macchiato' | 'latte' | 'print'
 * @param {number}      [alpha]   - opacity of the background (default 0.30)
 * @returns {{ backgroundColor: string } | {}}
 */
export function valBgStyle(value, minValue, maxValue, theme, alpha = 0.30) {
  if (value == null || isNaN(value) || minValue === maxValue) return {}
  const t = Math.max(0, Math.min((value - minValue) / (maxValue - minValue), 1))
  const colors = GRADIENT_COLORS[theme] ?? GRADIENT_COLORS.dark
  const hex = interpolateHex(colors.low, colors.high, t)
  return { backgroundColor: hexToRgba(hex, alpha) }
}

/**
 * Returns a backgroundColor inline style for a PS% cell.
 * Scale is always fixed 0–100 (PS% is position-scoped by the backend).
 *
 * @param {number|null} psPct  - the player's PS% value (0–100)
 * @param {string}      theme  - 'dark' | 'macchiato' | 'latte' | 'print'
 * @param {number}      [alpha]
 * @returns {{ backgroundColor: string } | {}}
 */
export function psPctBgStyle(psPct, theme, alpha = 0.30) {
  return valBgStyle(psPct, 0, 100, theme, alpha)
}
