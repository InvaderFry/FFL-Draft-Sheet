import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'beersheet_watchlist'

function loadPersisted(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<string[]>(loadPersisted)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist))
    } catch { /* storage full or unavailable */ }
  }, [watchlist])

  const watched = useMemo(() => new Set(watchlist), [watchlist])

  const toggle = useCallback((id: string) => {
    if (!id) return
    setWatchlist(prev => (
      prev.includes(id)
        ? prev.filter(existing => existing !== id)
        : [id, ...prev]
    ))
  }, [])

  const isWatched = useCallback((id: string) => watched.has(id), [watched])

  return { watchlist, isWatched, toggle, count: watchlist.length }
}
