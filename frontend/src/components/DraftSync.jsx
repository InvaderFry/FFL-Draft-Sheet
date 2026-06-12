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
 * page refresh mid-draft reconnects in two clicks. The saved team choice is
 * scoped to its league — ESPN reuses small team ids across leagues, so a
 * stale myTeamId must never carry over to a different league. Credentials
 * (espn_s2/SWID) grant full ESPN account access, so they live in
 * sessionStorage instead — they survive a refresh mid-draft but vanish when
 * the tab closes. They never leave this browser except to this app's
 * backend, which forwards them to ESPN.
 */

import { useState, useEffect } from 'react'
import styles from './DraftSync.module.css'

const STORAGE_KEY = 'beersheet_espn_sync'
const CRED_KEY = 'beersheet_espn_creds'
const CURRENT_SEASON = (() => {
  const now = new Date()
  // The draft season flips over in spring, well before August drafts.
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1
})()

function loadSaved() {
  let settings = null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) settings = JSON.parse(raw)
  } catch (_) {}
  // Older versions persisted credentials to localStorage — scrub them.
  if (settings && (settings.espn_s2 || settings.swid)) {
    settings = { ...settings }
    delete settings.espn_s2
    delete settings.swid
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch (_) {}
  }
  // Read credentials even when the settings entry is missing (e.g. its write
  // failed): otherwise saved creds would be invisible to the form and the
  // next persist() would wipe them.
  let creds = null
  try {
    const raw = sessionStorage.getItem(CRED_KEY)
    if (raw) creds = JSON.parse(raw)
  } catch (_) {}
  if (!settings && !creds) return null
  return { ...settings, espn_s2: creds?.espn_s2 || '', swid: creds?.swid || '' }
}

function persist(settings) {
  const { espn_s2, swid } = settings
  const rest = { ...settings }
  delete rest.espn_s2
  delete rest.swid
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rest)) } catch (_) {}
  try {
    if (espn_s2 || swid) {
      sessionStorage.setItem(CRED_KEY, JSON.stringify({ espn_s2, swid }))
    } else {
      sessionStorage.removeItem(CRED_KEY)
    }
  } catch (_) {}
}

function forget() {
  try { localStorage.removeItem(STORAGE_KEY) } catch (_) {}
  try { sessionStorage.removeItem(CRED_KEY) } catch (_) {}
}

function agoLabel(ts, now) {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`
}

export default function DraftSync({ espnSync, defaultSeason = null }) {
  const {
    status, teams, myTeamId, setMyTeamId, error, lastSyncAtRef, pickCount,
    replayTotal, connect, disconnect, retry,
  } = espnSync
  const [open, setOpen] = useState(false)
  const [showPrivate, setShowPrivate] = useState(false)
  const [form, setForm] = useState(() => {
    const saved = loadSaved()
    return {
      leagueId: saved?.leagueId || '',
      // Prefer the season the sheet was generated for over the clock.
      season: saved?.season || defaultSeason || CURRENT_SEASON,
      espn_s2: saved?.espn_s2 || '',
      swid: saved?.swid || '',
      mock: saved?.mock || false,
      practice: saved?.practice || false,
    }
  })
  const [now, setNow] = useState(Date.now())

  // Restore the saved team choice once teams arrive after a reconnect —
  // only for the same league it was saved in.
  useEffect(() => {
    if (teams.length === 0 || myTeamId) return
    const saved = loadSaved()
    if (saved?.leagueId === form.leagueId && saved?.myTeamId &&
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

  useEffect(() => {
    if (form.mock) setShowPrivate(false)
  }, [form.mock])

  const update = (field, value) => setForm(f => ({ ...f, [field]: value }))

  const handleConnect = (e) => {
    e.preventDefault()
    if (!form.leagueId || !form.season) return
    const saved = loadSaved()
    // Carry the saved team choice forward only when reconnecting to the
    // league it belongs to.
    const myTeam = saved?.leagueId === form.leagueId ? saved?.myTeamId ?? null : null
    const connectSettings = form.mock ? { ...form, espn_s2: '', swid: '' } : form
    persist({ ...connectSettings, myTeamId: myTeam })
    setOpen(false)
    connect(connectSettings)
  }

  const handlePickTeam = (teamId) => {
    setMyTeamId(teamId || null)
    persist({ ...form, myTeamId: teamId || null })
  }

  const handleForget = () => {
    forget()
    setForm({
      leagueId: '',
      season: defaultSeason || CURRENT_SEASON,
      espn_s2: '',
      swid: '',
      mock: false,
      practice: false,
    })
    disconnect()
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
              For a Mock Draft Lobby room, install the tap userscript, set its
              SHEET_API value, check Live ESPN mock draft here, and connect
              before the draft starts.
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
                required
              />
            </label>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={form.mock}
                onChange={e => update('mock', e.target.checked)}
              />
              <span>
                Live ESPN mock draft — use the browser socket tap instead of
                ESPN REST polling
              </span>
            </label>
            {form.mock && (
              <div className={styles.mockHelp}>
                Install{' '}
                <a
                  href="https://github.com/InvaderFry/FFL-Draft-Sheet/raw/main/tools/espn-draft-tap.user.js"
                  target="_blank"
                  rel="noreferrer"
                >
                  espn-draft-tap.user.js
                </a>
                , set SHEET_API in the script to this backend, then reload the
                ESPN mock draft page before the draft starts.
              </div>
            )}
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={form.practice}
                onChange={e => update('practice', e.target.checked)}
              />
              <span>
                Practice replay — re-deal a completed draft pick-by-pick
                (set season to last year)
              </span>
            </label>
            {!form.mock && (
              <button
                type="button"
                className={styles.privateToggle}
                onClick={() => setShowPrivate(s => !s)}
              >
                {showPrivate ? '▾' : '▸'} Private league?
              </button>
            )}
            {!form.mock && showPrivate && (
              <div className={styles.privateSection}>
                <p className={styles.warning}>
                  ⚠ espn_s2 and SWID are cookies from espn.com that grant full
                  access to your ESPN account. They are kept only in this
                  browser tab (cleared when it closes) and sent only to this
                  app&apos;s backend to reach ESPN.
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
            <button type="submit" className={styles.submitBtn} disabled={!form.leagueId || !form.season}>
              Connect
            </button>
          </form>
        )}
      </div>
    )
  }

  const lastSyncAt = lastSyncAtRef.current
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
        {status === 'connected' && (replayTotal
          ? `Practice replay · ${pickCount}/${replayTotal} picks`
          : pickCount === 0
            ? `Connected · waiting for picks · ${agoLabel(lastSyncAt, now)}`
            : `Live · ${pickCount} picks · ${agoLabel(lastSyncAt, now)}`)}
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
        <button type="button" className={styles.linkBtn} onClick={disconnect}>
          disconnect
        </button>
      </span>
    </div>
  )
}
