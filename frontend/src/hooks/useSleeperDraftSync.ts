/**
 * Live Sleeper draft-room sync.
 *
 * Polls POST /api/draft/sleeper (a stateless backend proxy in front of
 * Sleeper's public v1 API) every POLL_MS while connected, maps each pick onto
 * the sheet's players, and feeds them into useDraftState via applySyncedPicks.
 *
 * This mirrors useEspnDraftSync's lifecycle (immediate fetch on connect, then
 * interval polling; abandon in-flight responses after disconnect/reconnect;
 * pause while the tab is hidden and resume on return; exponential backoff on
 * transient failures) but is simpler in two ways Sleeper allows: there are no
 * credentials (so no auth-expired path) and Sleeper picks already carry the
 * sleeper_id (so the primary sheet-row match is a direct bySleeperId hit rather
 * than ESPN's id-bridge + name heuristics). Practice replay and mock-lobby
 * ingest are ESPN-only and intentionally absent here.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { sleeperDraftBody } from '../api'
import { sameTeams, normName, matchByNamePos } from './draftSyncMatch'
import type { DraftSettings, DraftStatus, DraftTeam, PlayerRow, SheetResponse } from '../types/api'
import type { DraftedEntry, SheetEntry } from '../types/domain'

const API_URL = import.meta.env.VITE_API_URL || ''
const POLL_MS = 5000
const MAX_BACKOFF_MS = 60000
const MAX_SOFT_FAILURES = 3

type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'complete' | 'error'

/** Connect settings: the request fields plus the optional team selection. */
interface SleeperSettings extends DraftSettings {
  myTeamId?: string | number | null
}

/** Errors thrown from a poll carry whether they are permanent. */
interface SyncError extends Error {
  permanent?: boolean
}

interface SheetIndex {
  bySleeperId: Map<string, SheetEntry>
  byNamePos: Map<string, SheetEntry[]>
}

interface DraftSyncArgs {
  sheetData: SheetResponse | null | undefined
  applySyncedPicks: (picks: DraftedEntry[]) => void
}

export function useSleeperDraftSync({ sheetData, applySyncedPicks }: DraftSyncArgs) {
  const [status, setStatus] = useState<SyncStatus>('disconnected')
  const [teams, setTeams] = useState<DraftTeam[]>([])
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickCount, setPickCount] = useState(0)
  // A ref, not state: it advances on every successful poll, and making it
  // state would re-render the whole board every 5s for a value only the
  // status chip (which has its own 1s ticker) reads.
  const lastSyncAtRef = useRef<number | null>(null)
  const myTeamIdRef = useRef<string | null>(myTeamId)
  myTeamIdRef.current = myTeamId

  const settingsRef = useRef<SleeperSettings | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const failuresRef = useRef(0)
  // Permanent stop: draft complete or unrecoverable error. Blocks both the
  // scheduler and the visibility-resume path until connect()/retry().
  const stoppedRef = useRef(false)

  // Board-entry lookups, so synced picks cross off the same row the user would
  // have clicked (PlayerTable keys rows by sleeper_id || player_name).
  // bySleeperId is the primary match — Sleeper picks carry the sleeper_id
  // directly; byNamePos catches picks whose sleeper_id the sheet row lacks but
  // that the backend named anyway (e.g. a kicker the sheet doesn't list).
  const sheetIndex = useMemo<SheetIndex>(() => {
    const bySleeperId = new Map<string, SheetEntry>()
    const byNamePos = new Map<string, SheetEntry[]>() // key → candidates; >1 means ambiguous
    for (const players of Object.values<PlayerRow[]>(sheetData?.positions || {})) {
      for (const p of players) {
        const entry: SheetEntry = {
          id: p.sleeper_id || p.player_name,
          name: p.player_name,
          pos: p.pos,
          team: p.team,
        }
        if (p.sleeper_id) bySleeperId.set(String(p.sleeper_id), entry)
        if (p.player_name && p.pos) {
          const key = `${normName(p.player_name)}|${p.pos.toUpperCase()}`
          const candidates = byNamePos.get(key)
          if (candidates) candidates.push(entry)
          else byNamePos.set(key, [entry])
        }
      }
    }
    return { bySleeperId, byNamePos }
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
    if (typeof document !== 'undefined' && document.hidden) return
    timerRef.current = setTimeout(() => pollRef.current(), delay)
  }, [stopTimer])

  const poll = useCallback(async () => {
    const settings = settingsRef.current
    if (!settings) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const resp = await fetch(`${API_URL}/api/draft/sleeper`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sleeperDraftBody(settings)),
      })
      if (!resp.ok) {
        let detail = `Sync failed (HTTP ${resp.status})`
        try {
          const body = await resp.json()
          if (typeof body?.detail === 'string') detail = body.detail
          else if (resp.status === 422) detail = 'Invalid draft ID — check the connect form.'
        } catch { /* non-JSON error body — keep the default detail */ }
        // Bad-request/not-found/validation failures are permanent — retrying
        // the same draft id won't fix them.
        const permanent = [400, 404, 422].includes(resp.status)
        throw Object.assign(new Error(detail), { permanent })
      }
      const data = await resp.json() as DraftStatus
      // Abandon the response if disconnect()/connect() ran while in flight —
      // applying it would resurrect state the user just reset.
      if (settingsRef.current !== settings) return

      const teamNames = new Map((data.teams || []).map((t): [string, string] => [t.team_id, t.name]))
      const picks: DraftedEntry[] = (data.picks || []).map(pick => {
        const { bySleeperId, byNamePos } = sheetIndexRef.current
        const onSheet = (pick.sleeper_id && bySleeperId.get(String(pick.sleeper_id))) ||
          matchByNamePos(byNamePos, pick)
        return {
          // Off-sheet picks get a synthetic id so they still show in the
          // drafted list without colliding with board keys.
          id: onSheet?.id || pick.sleeper_id || pick.player_name || `sleeper:${pick.provider_player_id}`,
          name: onSheet?.name || pick.player_name || `Sleeper pick #${pick.overall}`,
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
      failuresRef.current = 0

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
        return // no reschedule; user must fix the input and reconnect
      }
      if (failuresRef.current >= MAX_SOFT_FAILURES) {
        setStatus('error')
        setError(e.message || 'Sync failed')
      }
      scheduleNext(Math.min(POLL_MS * 2 ** failuresRef.current, MAX_BACKOFF_MS))
    } finally {
      inFlightRef.current = false
      // If a new session connected while this poll was in flight, its immediate
      // fetch was blocked by the in-flight guard — kick it now.
      if (settingsRef.current && settingsRef.current !== settings) {
        scheduleNext(0)
      }
    }
  }, [scheduleNext])
  pollRef.current = poll

  const connect = useCallback((settings: SleeperSettings) => {
    // A fresh object per connect, so in-flight polls from a previous session
    // fail the identity check and abandon their responses.
    settingsRef.current = { ...settings }
    const initialMyTeamId = settings.myTeamId ? String(settings.myTeamId) : null
    myTeamIdRef.current = initialMyTeamId
    setMyTeamId(initialMyTeamId)
    failuresRef.current = 0
    stoppedRef.current = false
    setStatus('connecting')
    setError(null)
    poll()
  }, [poll])

  const disconnect = useCallback(() => {
    settingsRef.current = null
    stoppedRef.current = false
    stopTimer()
    setStatus('disconnected')
    setTeams([])
    setMyTeamId(null)
    setPickCount(0)
    lastSyncAtRef.current = null
    setError(null)
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
    poll()
  }, [poll])

  return {
    status, teams, myTeamId, setMyTeamId, error,
    // Sleeper has no credentials and no replay; surfaced as constants so the
    // shared status chip can destructure the same shape as the ESPN hook.
    authExpired: false, replayTotal: null,
    lastSyncAtRef, pickCount, connect, disconnect, retry,
  }
}
