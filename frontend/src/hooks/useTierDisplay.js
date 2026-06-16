import { useEffect, useState } from 'react'

const SHADE_KEY = 'ffl_tier_shade'
const LINES_KEY = 'ffl_tier_lines'

function read(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

/**
 * Owns the tier-display selection (which method shades rows, which draws
 * boundary lines), persisted to localStorage. Lifted to App so the interactive
 * board and the print view share one source of truth.
 */
export function useTierDisplay() {
  const [shadeBy, setShadeBy] = useState(() => read(SHADE_KEY, 'jenks'))
  const [linesBy, setLinesBy] = useState(() => read(LINES_KEY, 'none'))

  useEffect(() => {
    try { localStorage.setItem(SHADE_KEY, shadeBy) } catch { /* ignore */ }
  }, [shadeBy])
  useEffect(() => {
    try { localStorage.setItem(LINES_KEY, linesBy) } catch { /* ignore */ }
  }, [linesBy])

  return { shadeBy, setShadeBy, linesBy, setLinesBy }
}
