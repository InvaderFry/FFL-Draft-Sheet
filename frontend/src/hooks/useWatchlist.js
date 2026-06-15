import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'beersheet_watchlist'

function loadPersisted() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState(loadPersisted)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist))
    } catch (_) {}
  }, [watchlist])

  const watched = useMemo(() => new Set(watchlist), [watchlist])

  const toggle = useCallback((id) => {
    if (!id) return
    setWatchlist(prev => (
      prev.includes(id)
        ? prev.filter(existing => existing !== id)
        : [id, ...prev]
    ))
  }, [])

  const isWatched = useCallback((id) => watched.has(id), [watched])

  return { watchlist, isWatched, toggle, count: watchlist.length }
}
