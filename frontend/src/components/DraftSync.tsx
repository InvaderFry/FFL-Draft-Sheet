/**
 * DraftSync — connect the board to a live ESPN or Sleeper draft room.
 *
 * Renders in the DraftBoard header. When disconnected it shows an ESPN/Sleeper
 * provider toggle above a connect form; once either provider is connected the
 * live status chip (picks count, last sync, errors, team picker) is shown for
 * whichever one is active. Only one provider connects at a time — they share
 * the single drafted-state store.
 *
 * ESPN path (unchanged): league id + season, optional espn_s2/SWID for private
 * leagues. Connection settings persist in localStorage (beersheet_espn_sync);
 * credentials grant full ESPN account access so they live in sessionStorage
 * (beersheet_espn_creds), surviving a refresh but vanishing when the tab closes.
 *
 * Sleeper path: a single Draft ID (from the sleeper.com/draft/nfl/<id> URL).
 * Sleeper's draft API is public, so there are no credentials — settings persist
 * in localStorage (beersheet_sleeper_sync) with nothing sensitive. The saved
 * team choice is scoped to its draft id.
 */

import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { testEspnConnection, testSleeperConnection } from '../api'
import type { EspnSyncApi, SleeperSyncApi } from '../types/components'
import styles from './DraftSync.module.css'

const STORAGE_KEY = 'beersheet_espn_sync'
const CRED_KEY = 'beersheet_espn_creds'
const SLEEPER_KEY = 'beersheet_sleeper_sync'
const PROVIDER_KEY = 'beersheet_sync_provider'
const CURRENT_SEASON = (() => {
  const now = new Date()
  // The draft season flips over in spring, well before August drafts.
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1
})()

type Provider = 'espn' | 'sleeper'

interface EspnFormState {
  leagueId: string
  season: number | string
  espn_s2: string
  swid: string
  mock: boolean
  practice: boolean
}

interface SavedEspn {
  leagueId?: string
  season?: number | string
  espn_s2?: string
  swid?: string
  mock?: boolean
  practice?: boolean
  myTeamId?: string | null
}

interface SavedSleeper {
  draftId?: string
  myTeamId?: string | null
}

interface TestState {
  state: 'testing' | 'ok' | 'fail'
  msg: string
}

function loadProvider(): Provider {
  try {
    const p = localStorage.getItem(PROVIDER_KEY)
    if (p === 'espn' || p === 'sleeper') return p
  } catch { /* localStorage unavailable */ }
  return 'espn'
}

function loadSaved(): SavedEspn | null {
  let settings: SavedEspn | null = null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) settings = JSON.parse(raw)
  } catch { /* unreadable settings */ }
  // Older versions persisted credentials to localStorage — scrub them.
  if (settings && (settings.espn_s2 || settings.swid)) {
    settings = { ...settings }
    delete settings.espn_s2
    delete settings.swid
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
  }
  // Read credentials even when the settings entry is missing (e.g. its write
  // failed): otherwise saved creds would be invisible to the form and the
  // next persist() would wipe them.
  let creds: { espn_s2?: string; swid?: string } | null = null
  try {
    const raw = sessionStorage.getItem(CRED_KEY)
    if (raw) creds = JSON.parse(raw)
  } catch { /* unreadable creds */ }
  if (!settings && !creds) return null
  return { ...settings, espn_s2: creds?.espn_s2 || '', swid: creds?.swid || '' }
}

function persist(settings: Record<string, unknown>): void {
  const { espn_s2, swid } = settings
  const rest = { ...settings }
  delete rest.espn_s2
  delete rest.swid
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rest)) } catch { /* ignore */ }
  try {
    if (espn_s2 || swid) {
      sessionStorage.setItem(CRED_KEY, JSON.stringify({ espn_s2, swid }))
    } else {
      sessionStorage.removeItem(CRED_KEY)
    }
  } catch { /* ignore */ }
}

function forget(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  try { sessionStorage.removeItem(CRED_KEY) } catch { /* ignore */ }
}

function sleeperLoadSaved(): SavedSleeper | null {
  try {
    const raw = localStorage.getItem(SLEEPER_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* unreadable settings */ }
  return null
}

function sleeperPersist(settings: Record<string, unknown>): void {
  try { localStorage.setItem(SLEEPER_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
}

function sleeperForget(): void {
  try { localStorage.removeItem(SLEEPER_KEY) } catch { /* ignore */ }
}

function agoLabel(ts: number | null, now: number): string {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`
}

interface DraftSyncProps {
  espnSync: EspnSyncApi
  sleeperSync: SleeperSyncApi
  defaultSeason?: number | null
}

export default function DraftSync({ espnSync, sleeperSync, defaultSeason = null }: DraftSyncProps) {
  // When disconnected the selected tab drives the form; once a provider is
  // connected, that one is active regardless of the tab.
  const espnConnected = espnSync.status !== 'disconnected'
  const sleeperConnected = sleeperSync.status !== 'disconnected'
  const [provider, setProvider] = useState(loadProvider)
  const activeProvider: Provider = espnConnected ? 'espn' : sleeperConnected ? 'sleeper' : provider
  const activeSync = activeProvider === 'sleeper' ? sleeperSync : espnSync

  const {
    status, teams, myTeamId, setMyTeamId, error, authExpired, lastSyncAtRef,
    pickCount, replayTotal, disconnect, retry,
  } = activeSync

  const [open, setOpen] = useState(false)
  const [showPrivate, setShowPrivate] = useState(false)
  // Pre-flight result: null | { state: 'testing'|'ok'|'fail', msg }
  const [test, setTest] = useState<TestState | null>(null)
  const [form, setForm] = useState<EspnFormState>(() => {
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
  const [sleeperForm, setSleeperForm] = useState(() => ({
    draftId: sleeperLoadSaved()?.draftId || '',
  }))
  const [now, setNow] = useState(Date.now())

  // Restore the saved team choice once teams arrive after a reconnect — only
  // for the same league/draft it was saved in.
  useEffect(() => {
    if (teams.length === 0 || myTeamId) return
    if (activeProvider === 'sleeper') {
      const saved = sleeperLoadSaved()
      if (saved?.draftId === sleeperForm.draftId && saved?.myTeamId &&
          teams.some(t => t.team_id === saved.myTeamId)) {
        setMyTeamId(saved.myTeamId)
      }
    } else {
      const saved = loadSaved()
      if (saved?.leagueId === form.leagueId && saved?.myTeamId &&
          teams.some(t => t.team_id === saved.myTeamId)) {
        setMyTeamId(saved.myTeamId)
      }
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

  const update = <K extends keyof EspnFormState>(field: K, value: EspnFormState[K]) => {
    setForm(f => ({ ...f, [field]: value }))
    // A stale pass/fail must not linger once the inputs it judged have changed.
    setTest(null)
  }

  const updateSleeper = (field: 'draftId', value: string) => {
    setSleeperForm(f => ({ ...f, [field]: value }))
    setTest(null)
  }

  const pickProvider = (p: Provider) => {
    setProvider(p)
    setTest(null)
    try { localStorage.setItem(PROVIDER_KEY, p) } catch { /* ignore */ }
  }

  // Pre-flight: validate league access (and cookies, for private leagues)
  // before the draft starts, so a stale espn_s2/SWID surfaces here instead of
  // on the first mid-draft poll.
  const handleTest = async () => {
    if (!form.leagueId || !form.season) return
    setTest({ state: 'testing', msg: 'Checking ESPN…' })
    const res = await testEspnConnection(form)
    if (res.ok) {
      setTest({ state: 'ok', msg: '✅ League reachable — credentials look good.' })
    } else if (res.status === 401) {
      setTest({ state: 'fail', msg: '⚠️ Expired or wrong cookies — refresh espn_s2 / SWID and try again.' })
    } else if (res.status === 404) {
      setTest({ state: 'fail', msg: 'League not found — check the league ID and season.' })
    } else {
      setTest({ state: 'fail', msg: res.detail || 'Could not validate the connection — try again.' })
    }
  }

  const handleSleeperTest = async () => {
    if (!sleeperForm.draftId) return
    setTest({ state: 'testing', msg: 'Checking Sleeper…' })
    const res = await testSleeperConnection(sleeperForm)
    if (res.ok) {
      setTest({ state: 'ok', msg: '✅ Draft reachable — ready to sync.' })
    } else if (res.status === 404) {
      setTest({ state: 'fail', msg: 'Draft not found — check the draft ID from the Sleeper URL.' })
    } else {
      setTest({ state: 'fail', msg: res.detail || 'Could not validate the connection — try again.' })
    }
  }

  // From the auth-expired chip: drop the dead session and reopen the form with
  // the private section expanded so the user can paste fresh cookies.
  const handleReconnect = () => {
    setTest(null)
    setShowPrivate(true)
    setOpen(true)
    disconnect()
  }

  const handleConnect = (e: FormEvent) => {
    e.preventDefault()
    if (!form.leagueId || !form.season) return
    const saved = loadSaved()
    // Carry the saved team choice forward only when reconnecting to the
    // league it belongs to.
    const myTeam = saved?.leagueId === form.leagueId ? saved?.myTeamId ?? null : null
    const connectSettings = form.mock
      ? { ...form, myTeamId: myTeam, espn_s2: '', swid: '' }
      : { ...form, myTeamId: myTeam }
    persist({ ...connectSettings, myTeamId: myTeam })
    setOpen(false)
    espnSync.connect(connectSettings)
  }

  const handleSleeperConnect = (e: FormEvent) => {
    e.preventDefault()
    if (!sleeperForm.draftId) return
    const saved = sleeperLoadSaved()
    const myTeam = saved?.draftId === sleeperForm.draftId ? saved?.myTeamId ?? null : null
    const connectSettings = { ...sleeperForm, myTeamId: myTeam }
    sleeperPersist(connectSettings)
    setOpen(false)
    sleeperSync.connect(connectSettings)
  }

  const handlePickTeam = (teamId: string) => {
    setMyTeamId(teamId || null)
    if (activeProvider === 'sleeper') {
      sleeperPersist({ ...sleeperForm, myTeamId: teamId || null })
    } else {
      persist({ ...form, myTeamId: teamId || null })
    }
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

  const handleSleeperForget = () => {
    sleeperForget()
    setSleeperForm({ draftId: '' })
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
          ⚡ Sync live draft
        </button>
        {open && (
          <div className={styles.panel}>
            <div className={styles.providerTabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={provider === 'espn'}
                className={`${styles.providerTab} ${provider === 'espn' ? styles.providerTabActive : ''}`}
                onClick={() => pickProvider('espn')}
              >
                ESPN
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={provider === 'sleeper'}
                className={`${styles.providerTab} ${provider === 'sleeper' ? styles.providerTabActive : ''}`}
                onClick={() => pickProvider('sleeper')}
              >
                Sleeper
              </button>
            </div>

            {provider === 'sleeper' ? (
              <form className={styles.providerForm} onSubmit={handleSleeperConnect}>
                <div className={styles.panelTitle}>Live Sleeper draft sync</div>
                <p className={styles.hint}>
                  Picks made in your Sleeper draft room are crossed off here
                  automatically. Find the draft ID in the draft URL:
                  sleeper.com/draft/nfl/<strong>&lt;draft id&gt;</strong>. Public
                  mock drafts work too.
                </p>
                <label className={styles.field}>
                  <span>Draft ID</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={sleeperForm.draftId}
                    onChange={e => updateSleeper('draftId', e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 1109123456789012345"
                    required
                  />
                </label>
                <button
                  type="button"
                  className={styles.testBtn}
                  onClick={handleSleeperTest}
                  disabled={!sleeperForm.draftId || test?.state === 'testing'}
                >
                  {test?.state === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {test && test.state !== 'testing' && (
                  <p
                    className={`${styles.testMsg} ${
                      test.state === 'ok' ? styles.testMsgOk : styles.testMsgFail
                    }`}
                    role="status"
                  >
                    {test.msg}
                  </p>
                )}
                {sleeperLoadSaved()?.draftId && (
                  <button type="button" className={styles.forgetBtn} onClick={handleSleeperForget}>
                    Forget saved draft
                  </button>
                )}
                <button type="submit" className={styles.submitBtn} disabled={!sleeperForm.draftId}>
                  Connect
                </button>
              </form>
            ) : (
              <form className={styles.providerForm} onSubmit={handleConnect}>
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
                {!form.mock && (
                  <button
                    type="button"
                    className={styles.testBtn}
                    onClick={handleTest}
                    disabled={!form.leagueId || !form.season || test?.state === 'testing'}
                  >
                    {test?.state === 'testing' ? 'Testing…' : 'Test connection'}
                  </button>
                )}
                {test && test.state !== 'testing' && (
                  <p
                    className={`${styles.testMsg} ${
                      test.state === 'ok' ? styles.testMsgOk : styles.testMsgFail
                    }`}
                    role="status"
                  >
                    {test.msg}
                  </p>
                )}
                <button type="submit" className={styles.submitBtn} disabled={!form.leagueId || !form.season}>
                  Connect
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    )
  }

  const providerLabel = activeProvider === 'sleeper' ? 'Sleeper' : 'ESPN'
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
        {status === 'connecting' && `Connecting to ${providerLabel}…`}
        {status === 'connected' && (replayTotal
          ? `Practice replay · ${pickCount}/${replayTotal} picks`
          : pickCount === 0
            ? `Connected · waiting for picks · ${agoLabel(lastSyncAt, now)}`
            : `Live · ${pickCount} picks · ${agoLabel(lastSyncAt, now)}`)}
        {status === 'complete' && `Draft complete · ${pickCount} picks`}
        {status === 'error' && authExpired && (
          <>
            <span className={styles.errorText} title={error || 'Credentials expired'}>
              Credentials expired — re-enter cookies
            </span>
            <button type="button" className={styles.linkBtn} onClick={handleReconnect}>reconnect</button>
          </>
        )}
        {status === 'error' && !authExpired && (
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
            title={`Mark which ${providerLabel} team is yours`}
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
