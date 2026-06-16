export function fmtVal(value) {
  if (value == null || isNaN(value)) return '—'
  if (value < 0) return `(${Math.abs(value).toFixed(1)})`
  return value.toFixed(1)
}

export function fmtInt(value) {
  if (value == null || isNaN(value)) return '—'
  if (value < 0) return `(${Math.round(Math.abs(value))})`
  return String(Math.round(value))
}

export function fmtPct(value) {
  if (value == null || isNaN(value)) return '—'
  return `${Number(value).toFixed(1)}%`
}
