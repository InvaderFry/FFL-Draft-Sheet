/**
 * U13 — Draft state manager
 *
 * Holds a Set of sleeper_ids that have been marked as "drafted".
 * Toggling a player adds/removes them from the set.
 * State persists for the lifetime of the session (React state; not localStorage).
 */

import { useState, useCallback } from 'react'

/**
 * @returns {{
 *   drafted: Set<string>,
 *   toggle: (sleeperId: string) => void,
 *   isDrafted: (sleeperId: string) => boolean,
 *   clear: () => void,
 *   count: number,
 * }}
 */
export function useDraftState() {
  const [drafted, setDrafted] = useState(() => new Set())

  const toggle = useCallback((sleeperId) => {
    if (!sleeperId) return
    setDrafted((prev) => {
      const next = new Set(prev)
      if (next.has(sleeperId)) {
        next.delete(sleeperId)
      } else {
        next.add(sleeperId)
      }
      return next
    })
  }, [])

  const isDrafted = useCallback(
    (sleeperId) => drafted.has(sleeperId),
    [drafted],
  )

  const clear = useCallback(() => setDrafted(new Set()), [])

  return { drafted, toggle, isDrafted, clear, count: drafted.size }
}
