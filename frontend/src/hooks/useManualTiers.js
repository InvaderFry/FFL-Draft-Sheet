import { useCallback, useEffect, useState } from 'react'
import { computeBoundaries } from '../utils/tierAccess'

const KEY_PREFIX = 'ffl_manual_tiers'

// Manual tiers are per-league: a 0.5-PPR sheet and a PPR sheet of the same
// season keep independent boundary sets.
function storageKey(config) {
  const season = config?.season ?? 'na'
  const ppr = config?.scoring?.rec ?? 'na'
  return `${KEY_PREFIX}:${season}:${ppr}`
}

function load(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Manual tier boundaries: per-position arrays of player ids that *start* a tier.
 * Seeded from another method, then nudged by the user. Persisted per league.
 * Consumers derive the id→tier map via tierAccess.deriveManualTiers.
 */
export function useManualTiers(config) {
  const key = storageKey(config)
  const [boundaries, setBoundaries] = useState(() => load(key))

  // Reload when the league (season/scoring) changes.
  useEffect(() => {
    setBoundaries(load(key))
  }, [key])

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(boundaries)) } catch { /* ignore */ }
  }, [key, boundaries])

  const seedFromMethod = useCallback((positions, method) => {
    setBoundaries(computeBoundaries(positions, method))
  }, [])

  const toggleBoundary = useCallback((pos, id) => {
    if (!pos || !id) return
    setBoundaries(prev => {
      const current = prev[pos] || []
      const next = current.includes(id)
        ? current.filter(existing => existing !== id)
        : [...current, id]
      return { ...prev, [pos]: next }
    })
  }, [])

  const clear = useCallback(() => setBoundaries({}), [])

  const hasManual = Object.values(boundaries).some(ids => ids && ids.length > 0)

  return { boundaries, seedFromMethod, toggleBoundary, clear, hasManual }
}
