/**
 * Live ESPN draft-room sync.
 *
 * Polls POST /api/draft/espn (a stateless backend proxy in front of ESPN's
 * v3 fantasy API) every POLL_MS while connected, maps each pick onto the
 * sheet's players, and feeds them into useDraftState via applySyncedPicks.
 *
 * Lifecycle: connect() fetches immediately (doubling as validation and
 * populating the team picker), then polls on an interval. Polling pauses
 * while the tab is hidden and resumes with an immediate fetch. Transient
 * failures back off exponentially (5s → 60s) and only flip status to
 * 'error' after MAX_SOFT_FAILURES in a row — before that the UI shows a
 * stale lastSyncAt. Polling stops for good when ESPN reports the draft
 * complete.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'

const API_URL = import.meta.env.VITE_API_URL || ''
const POLL_MS = 5000
const MAX_BACKOFF_MS = 60000
const MAX_SOFT_FAILURES = 3

export function useEspnDraftSync({ sheetData, applySyncedPicks }) {
  const [status, setStatus] = useState('disconnected') // disconnected | connecting | connected | complete | error
  const [teams, setTeams] = useState([])
  const [myTeamId, setMyTeamId] = useState(null)
  const [error, setError] = useState(null)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const [pickCount, setPickCount] = useState(0)

  const settingsRef = useRef(null)
  const timerRef = useRef(null)
  const inFlightRef = useRef(false)
  const failuresRef = useRef(0)
  const statusRef = useRef('disconnected')
  statusRef.current = status

  // espn_id → board entry, so synced picks cross off the same row the user
  // would have clicked (PlayerTable keys rows by sleeper_id || player_name).
  const espnIndex = useMemo(() => {
    const index = new Map()
    for (const players of Object.values(sheetData?.positions || {})) {
      for (const p of players) {
        if (p.espn_id) {
          index.set(String(p.espn_id), {
            id: p.sleeper_id || p.player_name,
            name: p.player_name,
            pos: p.pos,
          })
        }
      }
    }
    return index
  }, [sheetData])
  const espnIndexRef = useRef(espnIndex)
  espnIndexRef.current = espnIndex

  const applyRef = useRef(applySyncedPicks)
  applyRef.current = applySyncedPicks

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // poll and schedule call each other; the ref breaks the definition cycle.
  const pollRef = useRef(null)

  const schedule = useCallback((delay) => {
    stopTimer()
    if (!settingsRef.current) return
    timerRef.current = setTimeout(() => pollRef.current(), delay)
  }, [stopTimer])

  const poll = useCallback(async () => {
    const settings = settingsRef.current
    if (!settings || inFlightRef.current) return
    inFlightRef.current = true
    try {
      const resp = await fetch(`${API_URL}/api/draft/espn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: Number(settings.leagueId),
          season: Number(settings.season),
          espn_s2: settings.espn_s2 || null,
          swid: settings.swid || null,
        }),
      })
      if (!resp.ok) {
        let detail = `Sync failed (HTTP ${resp.status})`
        try {
          const body = await resp.json()
          if (body?.detail) detail = body.detail
        } catch (_) {}
        // Auth/not-found are permanent — retrying won't fix them.
        const permanent = resp.status === 401 || resp.status === 404
        throw Object.assign(new Error(detail), { permanent })
      }
      const data = await resp.json()

      const teamNames = new Map((data.teams || []).map(t => [t.team_id, t.name]))
      const picks = (data.picks || []).map(pick => {
        const onSheet = espnIndexRef.current.get(pick.provider_player_id)
        return {
          // Off-sheet picks get a synthetic id so they still show in the
          // drafted list without colliding with board keys.
          id: onSheet?.id || (pick.sleeper_id || pick.player_name
            ? (pick.sleeper_id || pick.player_name)
            : `espn:${pick.provider_player_id}`),
          name: onSheet?.name || pick.player_name || `ESPN pick #${pick.overall}`,
          pos: onSheet?.pos || pick.pos || '?',
          teamId: pick.team_id,
          teamName: teamNames.get(pick.team_id) || `Team ${pick.team_id}`,
          overall: pick.overall,
        }
      })

      applyRef.current(picks)
      setTeams(data.teams || [])
      setPickCount(picks.length)
      setLastSyncAt(Date.now())
      setError(null)
      failuresRef.current = 0

      if (data.complete && !data.in_progress) {
        setStatus('complete')
        return // no reschedule
      }
      setStatus('connected')
      schedule(POLL_MS)
    } catch (err) {
      failuresRef.current += 1
      if (err.permanent) {
        setStatus('error')
        setError(err.message)
        return // no reschedule; user must reconnect
      }
      if (failuresRef.current >= MAX_SOFT_FAILURES) {
        setStatus('error')
        setError(err.message || 'Sync failed')
      }
      schedule(Math.min(POLL_MS * 2 ** failuresRef.current, MAX_BACKOFF_MS))
    } finally {
      inFlightRef.current = false
    }
  }, [schedule])
  pollRef.current = poll

  const connect = useCallback((settings) => {
    settingsRef.current = settings
    failuresRef.current = 0
    setStatus('connecting')
    setError(null)
    poll()
  }, [poll])

  const disconnect = useCallback(() => {
    settingsRef.current = null
    stopTimer()
    setStatus('disconnected')
    setTeams([])
    setPickCount(0)
    setLastSyncAt(null)
    setError(null)
  }, [stopTimer])

  // Pause while hidden; fetch immediately on return.
  useEffect(() => {
    const onVisibility = () => {
      if (!settingsRef.current) return
      if (document.hidden) {
        stopTimer()
      } else if (statusRef.current === 'connected' || statusRef.current === 'connecting') {
        poll()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [poll, stopTimer])

  // Cleanup on unmount
  useEffect(() => stopTimer, [stopTimer])

  const retry = useCallback(() => {
    if (!settingsRef.current) return
    failuresRef.current = 0
    setStatus('connecting')
    setError(null)
    poll()
  }, [poll])

  return {
    status, teams, myTeamId, setMyTeamId, error, lastSyncAt, pickCount,
    connect, disconnect, retry,
  }
}
