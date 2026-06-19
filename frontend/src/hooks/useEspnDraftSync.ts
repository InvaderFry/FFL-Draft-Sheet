/**
 * Live ESPN draft-room sync.
 *
 * Polls POST /api/draft/espn (a stateless backend proxy in front of ESPN's
 * v3 fantasy API) every POLL_MS while connected, maps each pick onto the
 * sheet's players, and feeds them into useDraftState via applySyncedPicks.
 *
 * Lifecycle: connect() fetches immediately (doubling as validation and
 * populating the team picker), then polls on an interval. Each poll captures
 * the settings object it ran with and abandons its response if disconnect()
 * or a reconnect happened mid-flight. Polling pauses while the tab is hidden
 * (the scheduler refuses to arm a timer while hidden, so an in-flight poll
 * cannot re-start the loop) and resumes with an immediate fetch on return.
 * Transient failures back off exponentially (5s → 60s) and only flip status
 * to 'error' after MAX_SOFT_FAILURES in a row — the backoff loop keeps
 * retrying in that state and visibility resume covers it too. Polling stops
 * for good (stoppedRef) when ESPN reports the draft complete or the failure
 * is permanent (bad credentials, unknown league, invalid request).
 *
 * Practice replay: connect() with settings.practice re-deals a completed
 * draft (e.g. last season's) one pick every REPLAY_MS instead of applying it
 * wholesale, so the live-draft flow — picks streaming in, board crossing
 * off, team panel filling — can be rehearsed without a live draft. ESPN
 * mock-lobby rooms can also sync live when settings.mock is enabled and the
 * ESPN draft tab runs the userscript socket tap; the hook keeps polling the
 * backend ingest snapshot while the userscript feeds picks. Replay ticks
 * reuse the poll scheduler (and its hidden-tab pause) but never refetch; a
 * practice connect to a draft that is NOT complete falls through to normal
 * live polling.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { espnDraftBody } from '../api'
import { sameTeams, normName, matchByNamePos } from './draftSyncMatch'
import type { DraftSettings, DraftStatus, DraftTeam, PlayerRow, SheetResponse } from '../types/api'
import type { DraftedEntry, SheetEntry } from '../types/domain'

const API_URL = import.meta.env.VITE_API_URL || ''
const POLL_MS = 5000
const REPLAY_MS = 3000
const MAX_BACKOFF_MS = 60000
const MAX_SOFT_FAILURES = 3

type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'complete' | 'error'

/** Connect settings: the request fields plus ESPN-only sync options. */
interface EspnSettings extends DraftSettings {
  myTeamId?: string | number | null
  practice?: boolean
}

/** Errors thrown from a poll carry whether they are permanent / auth-related. */
interface SyncError extends Error {
  permanent?: boolean
  auth?: boolean
}

interface SheetIndex {
  byEspnId: Map<string, SheetEntry>
  byNamePos: Map<string, SheetEntry[]>
}

interface DraftSyncArgs {
  sheetData: SheetResponse | null | undefined
  applySyncedPicks: (picks: DraftedEntry[]) => void
}

export function useEspnDraftSync({ sheetData, applySyncedPicks }: DraftSyncArgs) {
  const [status, setStatus] = useState<SyncStatus>('disconnected')
  const [teams, setTeams] = useState<DraftTeam[]>([])
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // True when the last failure was a 401: cookies are stale/missing, so the
  // fix is re-entering credentials, not retrying the same request.
  const [authExpired, setAuthExpired] = useState(false)
  const [pickCount, setPickCount] = useState(0)
  // Total picks of an active practice replay; null during real syncs.
  const [replayTotal, setReplayTotal] = useState<number | null>(null)
  // A ref, not state: it advances on every successful poll, and making it
  // state would re-render the whole board every 5s for a value only the
  // status chip (which has its own 1s ticker) reads.
  const lastSyncAtRef = useRef<number | null>(null)
  const myTeamIdRef = useRef<string | null>(myTeamId)
  myTeamIdRef.current = myTeamId

  const settingsRef = useRef<EspnSettings | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const failuresRef = useRef(0)
  // Permanent stop: draft complete or unrecoverable error. Blocks both the
  // scheduler and the visibility-resume path until connect()/retry().
  const stoppedRef = useRef(false)
  // Active practice replay: { picks, revealed }. While set, scheduler ticks
  // reveal the next pick instead of fetching.
  const replayRef = useRef<{ picks: DraftedEntry[]; revealed: number } | null>(null)

  // Board-entry lookups, so synced picks cross off the same row the user
  // would have clicked (PlayerTable keys rows by sleeper_id || player_name).
  // byEspnId is the primary match; byNamePos catches picks whose espn_id the
  // sheet row is missing but that the backend identified by name anyway.
  const sheetIndex = useMemo<SheetIndex>(() => {
    const byEspnId = new Map<string, SheetEntry>()
    const byNamePos = new Map<string, SheetEntry[]>() // key → candidates; >1 means ambiguous
    for (const players of Object.values<PlayerRow[]>(sheetData?.positions || {})) {
      for (const p of players) {
        const entry: SheetEntry = {
          id: p.sleeper_id || p.player_name,
          name: p.player_name,
          pos: p.pos,
          team: p.team,
        }
        if (p.espn_id) byEspnId.set(String(p.espn_id), entry)
        if (p.player_name && p.pos) {
          const key = `${normName(p.player_name)}|${p.pos.toUpperCase()}`
          const candidates = byNamePos.get(key)
          if (candidates) candidates.push(entry)
          else byNamePos.set(key, [entry])
        }
      }
    }
    return { byEspnId, byNamePos }
  }, [sheetData])
  const sheetIndexRef = useRef(sheetIndex)
  sheetIndexRef.current = sheetIndex

  const applyRef = useRef(applySyncedPicks)
  applyRef.current = applySyncedPicks

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // poll and scheduleNext call each other; the ref breaks the definition cycle.
  const pollRef = useRef<() => void>(() => {})

  const scheduleNext = useCallback((delay: number) => {
    stopTimer()
    if (!settingsRef.current || stoppedRef.current) return
    // Never arm while hidden — the visibilitychange handler polls on return.
    // This also covers a poll that resolves after the tab was hidden.
    if (typeof document !== 'undefined' && document.hidden) return
    timerRef.current = setTimeout(() => pollRef.current(), delay)
  }, [stopTimer])

  const revealNext = useCallback(() => {
    const replay = replayRef.current
    if (!replay) return
    replay.revealed = Math.min(replay.revealed + 1, replay.picks.length)
    applyRef.current(replay.picks.slice(0, replay.revealed))
    setPickCount(replay.revealed)
    lastSyncAtRef.current = Date.now()
    if (replay.revealed >= replay.picks.length) {
      replayRef.current = null
      stoppedRef.current = true
      setStatus('complete')
      return
    }
    scheduleNext(REPLAY_MS)
  }, [scheduleNext])

  const poll = useCallback(async () => {
    const settings = settingsRef.current
    if (!settings) return
    // A replay tick (scheduler or visibility resume) reveals the next pick
    // of the already-fetched draft instead of refetching.
    if (replayRef.current) {
      revealNext()
      return
    }
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const resp = await fetch(`${API_URL}/api/draft/espn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(espnDraftBody(settings)),
      })
      if (!resp.ok) {
        let detail = `Sync failed (HTTP ${resp.status})`
        try {
          const body = await resp.json()
          // FastAPI 422 validation errors put a list of objects in detail.
          if (typeof body?.detail === 'string') detail = body.detail
          else if (resp.status === 422) detail = 'Invalid league ID or season — check the connect form.'
        } catch { /* non-JSON error body — keep the default detail */ }
        // Auth/not-found/validation failures are permanent — retrying the
        // same payload won't fix them. A 401 specifically means stale/missing
        // cookies, which the user fixes by re-entering them, not by retrying.
        const permanent = [400, 401, 404, 422].includes(resp.status)
        throw Object.assign(new Error(detail), { permanent, auth: resp.status === 401 })
      }
      const data = await resp.json() as DraftStatus
      // Abandon the response if disconnect()/connect() ran while in flight —
      // applying it would resurrect state the user just reset.
      if (settingsRef.current !== settings) return

      const teamNames = new Map((data.teams || []).map((t): [string, string] => [t.team_id, t.name]))
      const picks: DraftedEntry[] = (data.picks || []).map(pick => {
        const { byEspnId, byNamePos } = sheetIndexRef.current
        const onSheet = byEspnId.get(pick.provider_player_id) ||
          matchByNamePos(byNamePos, pick)
        return {
          // Off-sheet picks get a synthetic id so they still show in the
          // drafted list without colliding with board keys.
          id: onSheet?.id || pick.sleeper_id || pick.player_name || `espn:${pick.provider_player_id}`,
          name: onSheet?.name || pick.player_name || `ESPN pick #${pick.overall}`,
          pos: onSheet?.pos || pick.pos || '?',
          teamId: pick.team_id,
          teamName: teamNames.get(pick.team_id) || `Team ${pick.team_id}`,
          overall: pick.overall,
        }
      })

      setTeams(prev => sameTeams(prev, data.teams || []) ? prev : (data.teams || []))
      if (data.my_team_id != null && !myTeamIdRef.current) {
        setMyTeamId(String(data.my_team_id))
      }
      lastSyncAtRef.current = Date.now()
      setError(null)
      setAuthExpired(false)
      failuresRef.current = 0

      // Practice replay: hold the completed draft back and deal it out one
      // pick per tick. An incomplete draft can't be replayed — fall through
      // and sync it live.
      if (settings.practice && data.complete && picks.length > 0) {
        replayRef.current = { picks, revealed: 0 }
        setReplayTotal(picks.length)
        applyRef.current([])
        setPickCount(0)
        setStatus('connected')
        scheduleNext(REPLAY_MS)
        return
      }

      applyRef.current(picks)
      setPickCount(picks.length)

      if (data.complete && !data.in_progress) {
        stoppedRef.current = true
        setStatus('complete')
        return // no reschedule
      }
      setStatus('connected')
      scheduleNext(POLL_MS)
    } catch (err) {
      if (settingsRef.current !== settings) return // abandoned mid-flight
      const e = err as SyncError
      failuresRef.current += 1
      if (e.permanent) {
        stoppedRef.current = true
        setStatus('error')
        setError(e.message)
        if (e.auth) setAuthExpired(true)
        return // no reschedule; user must fix the input and reconnect
      }
      if (failuresRef.current >= MAX_SOFT_FAILURES) {
        setStatus('error')
        setError(e.message || 'Sync failed')
      }
      scheduleNext(Math.min(POLL_MS * 2 ** failuresRef.current, MAX_BACKOFF_MS))
    } finally {
      inFlightRef.current = false
      // If a new session connected while this poll was in flight, its
      // immediate fetch was blocked by the in-flight guard — kick it now.
      if (settingsRef.current && settingsRef.current !== settings) {
        scheduleNext(0)
      }
    }
  }, [scheduleNext, revealNext])
  pollRef.current = poll

  const connect = useCallback((settings: EspnSettings) => {
    // A fresh object per connect, so in-flight polls from a previous session
    // fail the identity check and abandon their responses.
    settingsRef.current = { ...settings }
    const initialMyTeamId = settings.myTeamId ? String(settings.myTeamId) : null
    myTeamIdRef.current = initialMyTeamId
    setMyTeamId(initialMyTeamId)
    failuresRef.current = 0
    stoppedRef.current = false
    replayRef.current = null
    setReplayTotal(null)
    setStatus('connecting')
    setError(null)
    setAuthExpired(false)
    poll()
  }, [poll])

  const disconnect = useCallback(() => {
    settingsRef.current = null
    stoppedRef.current = false
    replayRef.current = null
    setReplayTotal(null)
    stopTimer()
    setStatus('disconnected')
    setTeams([])
    setMyTeamId(null)
    setPickCount(0)
    lastSyncAtRef.current = null
    setError(null)
    setAuthExpired(false)
  }, [stopTimer])

  // Pause while hidden; fetch immediately on return. Resumes any non-stopped
  // session — including soft-failure 'error', whose backoff timer the hide
  // path cancels.
  useEffect(() => {
    const onVisibility = () => {
      if (!settingsRef.current || stoppedRef.current) return
      if (document.hidden) {
        stopTimer()
      } else {
        pollRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [stopTimer])

  // Cleanup on unmount
  useEffect(() => stopTimer, [stopTimer])

  const retry = useCallback(() => {
    if (!settingsRef.current) return
    failuresRef.current = 0
    stoppedRef.current = false
    setStatus('connecting')
    setError(null)
    setAuthExpired(false)
    poll()
  }, [poll])

  return {
    status, teams, myTeamId, setMyTeamId, error, authExpired, lastSyncAtRef,
    pickCount, replayTotal, connect, disconnect, retry,
  }
}
