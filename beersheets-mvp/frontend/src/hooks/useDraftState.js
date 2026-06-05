/**
 * U13 — Draft state manager
 *
 * Holds a Set of sleeper_ids that have been marked as "drafted".
 * Toggling a player adds/removes them from the set.
 * State persists for the lifetime of the session (React state; not localStorage).
 */

import { useState, useCallback, useMemo } from 'react'

export function useDraftState() {
  // Ordered array of {id, name, pos}, newest first
  const [draftedList, setDraftedList] = useState([])

  const drafted = useMemo(() => new Set(draftedList.map(p => p.id)), [draftedList])

  const toggle = useCallback((id, name, pos) => {
    if (!id) return
    setDraftedList(prev =>
      prev.some(p => p.id === id)
        ? prev.filter(p => p.id !== id)
        : [{ id, name, pos }, ...prev]
    )
  }, [])

  const isDrafted = useCallback((id) => drafted.has(id), [drafted])

  const clear = useCallback(() => setDraftedList([]), [])

  return { draftedList, toggle, isDrafted, clear, count: draftedList.length }
}
