/**
 * Tier access helpers for the multi-method tier display.
 *
 * Each player carries a `tiers` map ({ jenks, gmm, boris_chen, ... }) from the
 * backend. The flat `tier` field mirrors the default (jenks) method for
 * back-compat with older payloads that predate `tiers`.
 */

// All selectable tier methods, in display order. `available` is resolved at
// runtime from the loaded sheet (see methodAvailable).
export const TIER_METHODS = [
  { id: 'jenks', label: 'Jenks' },
  { id: 'gmm', label: 'GMM' },
  { id: 'boris_chen', label: 'Boris Chen' },
  { id: 'manual', label: 'Manual' },
]

/**
 * The tier number for a player under a given method, or null when absent.
 * Jenks falls back to the legacy flat `tier` field for older payloads.
 */
export function tierFor(player, method, manualTiers = null) {
  if (!player || !method || method === 'none') return null
  if (method === 'manual') {
    if (!manualTiers) return null
    const id = player.sleeper_id || player.player_name
    return manualTiers[id] ?? null
  }
  const t = player.tiers?.[method]
  if (t != null) return t
  return method === 'jenks' ? (player.tier ?? null) : null
}

/**
 * Whether a method has any data across the loaded positions. Jenks/none are
 * always available; manual is available once seeded (non-empty manualTiers).
 */
export function methodAvailable(positions, method, manualTiers = null) {
  if (method === 'none' || method === 'jenks') return true
  if (method === 'manual') return !!manualTiers && Object.keys(manualTiers).length > 0
  for (const pos of Object.keys(positions || {})) {
    for (const p of positions[pos] || []) {
      if (p.tiers && p.tiers[method] != null) return true
    }
  }
  return false
}
