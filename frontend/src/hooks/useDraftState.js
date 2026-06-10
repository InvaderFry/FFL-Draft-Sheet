/**
 * U13 — Draft state manager
 *
 * Holds an ordered list of drafted players. Entries come from two sources:
 *   - 'manual': the user clicked a row to cross a player off
 *   - 'espn':   synced from a live ESPN draft room (with team attribution)
 *
 * Toggling an ESPN-synced entry is a no-op — ESPN is the source of truth and
 * the pick would reappear on the next poll anyway; undo it in the draft room.
 *
 * State persists for the lifetime of the session (React state; not
 * localStorage). clear() wipes everything — synced picks re-hydrate from ESPN
 * within one poll, so this is the correct "reset" behavior while connected.
 */

import { useState, useCallback, useMemo } from 'react'

export function useDraftState() {
  // Ordered array of {id, name, pos, source, teamId?, teamName?, overall?},
  // newest first
  const [draftedList, setDraftedList] = useState([])

  const drafted = useMemo(() => new Set(draftedList.map(p => p.id)), [draftedList])

  const toggle = useCallback((id, name, pos) => {
    if (!id) return
    setDraftedList(prev => {
      const existing = prev.find(p => p.id === id)
      if (existing) {
        if (existing.source === 'espn') return prev
        return prev.filter(p => p.id !== id)
      }
      return [{ id, name, pos, source: 'manual' }, ...prev]
    })
  }, [])

  /**
   * Idempotent upsert of the full synced picks list, called on every poll.
   * picks: [{id, name, pos, teamId, teamName, overall}], any order.
   * Manual entries that ESPN later confirms are promoted to source 'espn'.
   */
  const applySyncedPicks = useCallback((picks) => {
    setDraftedList(prev => {
      const prevById = new Map(prev.map(p => [p.id, p]))
      let changed = false

      const synced = []
      for (const pick of picks) {
        if (!pick.id) continue
        const entry = { ...pick, source: 'espn' }
        const existing = prevById.get(pick.id)
        if (!existing) {
          changed = true
        } else if (existing.source !== 'espn' || existing.teamId !== entry.teamId) {
          changed = true
        }
        synced.push(entry)
      }
      if (!changed && synced.length === prev.filter(p => p.source === 'espn').length) {
        return prev
      }

      // Synced picks newest-first on top, untouched manual entries below.
      const syncedIds = new Set(synced.map(p => p.id))
      synced.sort((a, b) => (b.overall || 0) - (a.overall || 0))
      const manual = prev.filter(p => p.source !== 'espn' && !syncedIds.has(p.id))
      return [...synced, ...manual]
    })
  }, [])

  const isDrafted = useCallback((id) => drafted.has(id), [drafted])

  const clear = useCallback(() => setDraftedList([]), [])

  return { draftedList, toggle, applySyncedPicks, isDrafted, clear, count: draftedList.length }
}
