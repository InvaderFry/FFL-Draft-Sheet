/**
 * DraftSync — connect the board to a live ESPN draft room.
 *
 * Renders in the DraftBoard header. Three states:
 *   1. disconnected → "Sync ESPN draft" button expanding to a connect form
 *      (league id, season, optional espn_s2/SWID for private leagues)
 *   2. connected, no team chosen → "Which team is yours?" picker (skippable)
 *   3. connected → live status chip (picks count, last sync, errors)
 *
 * Connection settings persist in localStorage (key beersheet_espn_sync) so a
 * page refresh mid-draft reconnects in two clicks. Credentials never leave
 * this browser except to this app's backend, which forwards them to ESPN.
 */

import { useState, useEffect } from 'react'
import styles from './DraftSync.module.css'

const STORAGE_KEY = 'beersheet_espn_sync'
const CURRENT_SEASON = (() => {
  const now = new Date()
  // The draft season flips over in spring, well before August drafts.
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1
})()

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) {}
  return null
}

function persist(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch (_) {}
}

function forget() {
  try { localStorage.removeItem(STORAGE_KEY) } catch (_) {}
}

function agoLabel(ts, now) {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`
}

export default function DraftSync({ espnSync }) {
  const { status, teams, myTeamId, setMyTeamId, error, lastSyncAt, pickCount, connect, disconnect, retry } = espnSync
  const [open, setOpen] = useState(false)
  const [showPrivate, setShowPrivate] = useState(false)
  const saved = loadSaved()
  const [form, setForm] = useState({
    leagueId: saved?.leagueId || '',
    season: saved?.season || CURRENT_SEASON,
    espn_s2: saved?.espn_s2 || '',
    swid: saved?.swid || '',
  })
  const [now, setNow] = useState(Date.now())

  // Restore the saved team choice once teams arrive after a reconnect.
  useEffect(() => {
    if (teams.length > 0 && !myTeamId && saved?.myTeamId &&
        teams.some(t => t.team_id === saved.myTeamId)) {
      setMyTeamId(saved.myTeamId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams])

  // Tick the "synced Xs ago" label while connected.
  useEffect(() => {
    if (status !== 'connected' && status !== 'error') return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [status])

  const update = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleConnect = (e) => {
    e.preventDefault()
    if (!form.leagueId) return
    persist({ ...form, myTeamId: saved?.myTeamId || null })
    setOpen(false)
    connect(form)
  }

  const handlePickTeam = (teamId) => {
    setMyTeamId(teamId || null)
    persist({ ...form, myTeamId: teamId || null })
  }

  const handleDisconnect = () => {
    disconnect()
    setMyTeamId(null)
  }

  const handleForget = () => {
    forget()
    setForm({ leagueId: '', season: CURRENT_SEASON, espn_s2: '', swid: '' })
    handleDisconnect()
  }

  if (status === 'disconnected') {
    return (
      <div className={styles.wrap}>
        <button
          type="button"
          className={styles.connectBtn}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          ⚡ Sync ESPN draft
        </button>
        {open && (
          <form className={styles.panel} onSubmit={handleConnect}>
            <div className={styles.panelTitle}>Live ESPN draft sync</div>
            <p className={styles.hint}>
              Picks made in your ESPN draft room are crossed off here automatically.
            </p>
            <label className={styles.field}>
              <span>League ID</span>
              <input
                type="text"
                inputMode="numeric"
                value={form.leagueId}
                onChange={e => update('leagueId', e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 12345678"
                required
              />
            </label>
            <label className={styles.field}>
              <span>Season</span>
              <input
                type="number"
                value={form.season}
                onChange={e => update('season', e.target.value)}
                min="2018"
                max="2035"
              />
            </label>
            <button
              type="button"
              className={styles.privateToggle}
              onClick={() => setShowPrivate(s => !s)}
            >
              {showPrivate ? '▾' : '▸'} Private league?
            </button>
            {showPrivate && (
              <div className={styles.privateSection}>
                <p className={styles.warning}>
                  ⚠ espn_s2 and SWID are cookies from espn.com that grant full
                  access to your ESPN account. They are stored only in this
                  browser and sent only to this app's backend to reach ESPN.
                </p>
                <label className={styles.field}>
                  <span>espn_s2</span>
                  <input
                    type="password"
                    value={form.espn_s2}
                    onChange={e => update('espn_s2', e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className={styles.field}>
                  <span>SWID</span>
                  <input
                    type="password"
                    value={form.swid}
                    onChange={e => update('swid', e.target.value)}
                    placeholder="{...}"
                    autoComplete="off"
                  />
                </label>
                <button type="button" className={styles.forgetBtn} onClick={handleForget}>
                  Forget saved credentials
                </button>
              </div>
            )}
            <button type="submit" className={styles.submitBtn} disabled={!form.leagueId}>
              Connect
            </button>
          </form>
        )}
      </div>
    )
  }

  const dotClass =
    status === 'error' ? styles.dotError
    : status === 'complete' ? styles.dotDone
    : status === 'connecting' ? styles.dotConnecting
    : (lastSyncAt && now - lastSyncAt > 20000) ? styles.dotStale
    : styles.dotLive

  return (
    <div className={styles.wrap}>
      <span className={styles.chip}>
        <span className={`${styles.dot} ${dotClass}`} />
        {status === 'connecting' && 'Connecting to ESPN…'}
        {status === 'connected' && `Live · ${pickCount} picks · ${agoLabel(lastSyncAt, now)}`}
        {status === 'complete' && `Draft complete · ${pickCount} picks`}
        {status === 'error' && (
          <>
            <span className={styles.errorText} title={error || 'Sync failed'}>
              {error || 'Sync failed'}
            </span>
            <button type="button" className={styles.linkBtn} onClick={retry}>retry</button>
          </>
        )}
        {status !== 'connecting' && teams.length > 0 && (
          <select
            className={styles.teamSelect}
            value={myTeamId || ''}
            onChange={e => handlePickTeam(e.target.value)}
            title="Mark which ESPN team is yours"
          >
            <option value="">My team…</option>
            {teams.map(t => (
              <option key={t.team_id} value={t.team_id}>{t.name}</option>
            ))}
          </select>
        )}
        <button type="button" className={styles.linkBtn} onClick={handleDisconnect}>
          disconnect
        </button>
      </span>
    </div>
  )
}
