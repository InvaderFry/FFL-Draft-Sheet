export function fmtVal(value) {
  if (value == null || isNaN(value)) return '—'
  if (value < 0) return `(${Math.abs(value).toFixed(1)})`
  return value.toFixed(1)
}
