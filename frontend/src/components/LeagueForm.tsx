/**
 * U12 — League settings form
 *
 * Collects league configuration and calls POST /api/sheet.
 * Persists last-used settings in localStorage for convenience.
 */

import { useState, useEffect, useRef } from 'react'
import type { SheetResponse } from '../types/api'
import type { LeagueConfig } from '../types/domain'
import styles from './LeagueForm.module.css'

const API_URL = import.meta.env.VITE_API_URL || ''

// The FantasyPros API key is a credential, so it lives in sessionStorage
// (tab-scoped, cleared when the tab closes) rather than the localStorage
// settings blob — mirroring how DraftSync handles espn_s2/SWID.
const FP_KEY_STORAGE = 'beersheet_fp_key'

/**
 * Form values. Numeric fields may hold either a number (defaults / select
 * inputs) or a string (mid-edit text/number inputs), so reads coerce via
 * toInt/toFloat. The index signature supports the dynamic field maps below.
 */
interface Settings {
  n_teams: number | string
  fantasy_weeks: number | string
  QB: number | string
  RB: number | string
  WR: number | string
  TE: number | string
  DST: number | string
  K: number | string
  flex_slots: number | string
  bench_spots: number | string
  flex_rb: number | string
  flex_wr: number | string
  flex_te: number | string
  flex_qb: number | string
  ppr: string
  pass_td: number | string
  rush_td: number | string
  rec_td: number | string
  pass_yds: number | string
  rush_yds: number | string
  rec_yds: number | string
  interception: number | string
  fumble_lost: number | string
  te_premium: number | string
  auction_mode: boolean
  auction_budget: number | string
  [key: string]: number | string | boolean
}

const DEFAULT_SETTINGS: Settings = {
  n_teams: 12,
  fantasy_weeks: 14,
  QB: 1, RB: 2, WR: 3, TE: 1, DST: 1, K: 0,
  flex_slots: 1,
  bench_spots: 6,
  flex_rb: 0.5, flex_wr: 0.4, flex_te: 0.1, flex_qb: 0.0,
  ppr: '0.5',     // UI-only; maps to scoring.rec below
  pass_td: 4, rush_td: 6, rec_td: 6,
  pass_yds: 0.04, rush_yds: 0.1, rec_yds: 0.1,
  interception: -2, fumble_lost: -2,
  te_premium: 0,
  auction_mode: false,
  auction_budget: 200,
}

type FieldValue = number | string | boolean

const toInt = (v: FieldValue): number => parseInt(String(v), 10)
const toFloat = (v: FieldValue): number => parseFloat(String(v))

function pprToRec(ppr: string): number {
  const n = parseFloat(ppr)
  return isNaN(n) ? 0.5 : n
}

function loadSaved(): Settings {
  try {
    const raw = localStorage.getItem('beersheet_settings')
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch { /* unreadable settings */ }
  return DEFAULT_SETTINGS
}

interface LeagueFormProps {
  onSheet: (data: SheetResponse, config: LeagueConfig) => void
  onLoading: (loading: boolean) => void
  onError: (message: string) => void
  error?: string | null
}

type ValidationErrors = Record<string, string | undefined>

export default function LeagueForm({ onSheet, onLoading, onError, error }: LeagueFormProps) {
  const [settings, setSettings] = useState(loadSaved)
  const [loading, setLoading] = useState(false)
  const [validationError, setValidationError] = useState<ValidationErrors>({})
  const [clearStatus, setClearStatus] = useState<'clearing' | 'cleared' | 'error' | null>(null)
  const [fpKey, setFpKey] = useState(() => {
    try { return sessionStorage.getItem(FP_KEY_STORAGE) || '' } catch { return '' }
  })
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Persist settings
  useEffect(() => {
    try { localStorage.setItem('beersheet_settings', JSON.stringify(settings)) } catch { /* ignore */ }
  }, [settings])

  // Persist the FantasyPros key to sessionStorage only (never localStorage).
  useEffect(() => {
    try {
      if (fpKey) sessionStorage.setItem(FP_KEY_STORAGE, fpKey)
      else sessionStorage.removeItem(FP_KEY_STORAGE)
    } catch { /* ignore */ }
  }, [fpKey])

  // Cancel any pending clear-status reset on unmount to avoid setState on detached instance
  useEffect(() => {
    return () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current) }
  }, [])

  function update(field: string, value: FieldValue) {
    setSettings(s => ({ ...s, [field]: value }))
    setValidationError(e => ({ ...e, [field]: undefined }))
  }

  // One-click FLEX-split presets. Superflex routes the flex slot to QB; standard
  // restores the RB/WR/TE split. Both sum to 1.0, clearing the flex error.
  function applyFlexPreset(alloc: Record<string, number>) {
    setSettings(s => ({ ...s, ...alloc }))
    setValidationError(e => ({ ...e, flex: undefined }))
  }

  function validate(): ValidationErrors {
    const errs: ValidationErrors = {}
    if (toInt(settings.n_teams) < 8 || toInt(settings.n_teams) > 16)
      errs.n_teams = 'Teams must be 8–16'
    if (toInt(settings.fantasy_weeks) < 10 || toInt(settings.fantasy_weeks) > 18)
      errs.fantasy_weeks = 'Weeks must be 10–18'
    const benchSpots = toInt(settings.bench_spots)
    if (Number.isNaN(benchSpots) || benchSpots < 0 || benchSpots > 20)
      errs.bench_spots = 'Bench must be 0–20'
    const flexSum = toFloat(settings.flex_rb) + toFloat(settings.flex_wr) + toFloat(settings.flex_te) + toFloat(settings.flex_qb)
    if (Math.abs(flexSum - 1.0) > 0.01)
      errs.flex = `Flex allocations must sum to 1.0 (currently ${flexSum.toFixed(2)})`
    for (const f of ['pass_td','rush_td','rec_td','pass_yds','rush_yds','rec_yds','interception','fumble_lost','te_premium']) {
      if (settings[f] === '' || isNaN(toFloat(settings[f])))
        errs[f] = 'Required'
    }
    return errs
  }

  async function handleClearCache() {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    setClearStatus('clearing')
    try {
      const res = await fetch(`${API_URL}/api/cache/clear`, { method: 'POST' })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      setClearStatus('cleared')
    } catch {
      setClearStatus('error')
    } finally {
      clearTimerRef.current = setTimeout(() => setClearStatus(null), 3000)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setValidationError(errs); return }

    const rec = pprToRec(settings.ppr)
    const payload: LeagueConfig = {
      season: 2026,
      n_teams: toInt(settings.n_teams),
      fantasy_weeks: toInt(settings.fantasy_weeks),
      QB: toInt(settings.QB),
      RB: toInt(settings.RB),
      WR: toInt(settings.WR),
      TE: toInt(settings.TE),
      DST: toInt(settings.DST),
      K: toInt(settings.K),
      flex_slots: toInt(settings.flex_slots),
      bench_spots: toInt(settings.bench_spots),
      flex_rb: toFloat(settings.flex_rb),
      flex_wr: toFloat(settings.flex_wr),
      flex_te: toFloat(settings.flex_te),
      flex_qb: toFloat(settings.flex_qb),
      auction_mode: settings.auction_mode,
      auction_budget: toInt(settings.auction_budget),
      scoring: {
        rec,
        pass_td: toFloat(settings.pass_td),
        rush_td: toFloat(settings.rush_td),
        rec_td: toFloat(settings.rec_td),
        pass_yds: toFloat(settings.pass_yds),
        rush_yds: toFloat(settings.rush_yds),
        rec_yds: toFloat(settings.rec_yds),
        interception: toFloat(settings.interception),
        fumble_lost: toFloat(settings.fumble_lost),
        te_premium: toFloat(settings.te_premium),
      },
    }

    // Send the key only when present, and only in the request body — never in
    // the `payload` handed to onSheet (which becomes App-level config state).
    const trimmedKey = fpKey.trim()
    const body = trimmedKey ? { ...payload, fantasypros_api_key: trimmedKey } : payload

    setLoading(true)
    onLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        // detail may be a non-string (e.g. FastAPI 422 validation arrays) —
        // fall back to the status rather than rendering "[object Object]".
        const detail = typeof errBody.detail === 'string' ? errBody.detail : null
        throw new Error(detail || `Server error ${res.status}`)
      }
      const data = await res.json() as SheetResponse
      onSheet(data, payload)
    } catch (err) {
      // Surface the error to App, which keeps the form mounted so the message
      // is actually shown (and the user can retry) instead of hanging on the
      // loading spinner.
      onError(err instanceof Error ? err.message : 'Failed to generate sheet. Please try again.')
    } finally {
      setLoading(false)
      onLoading(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.grid}>
        {/* League basics */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>League</h3>
          <label className={styles.field}>
            <span>Teams</span>
            <select value={settings.n_teams} onChange={e => update('n_teams', parseInt(e.target.value))}>
              {[8,9,10,11,12,14,16].map(n => <option key={n}>{n}</option>)}
            </select>
            {validationError.n_teams && <span className={styles.fieldError}>{validationError.n_teams}</span>}
          </label>
          <label className={styles.field}>
            <span>Reg. season weeks</span>
            <select value={settings.fantasy_weeks} onChange={e => update('fantasy_weeks', parseInt(e.target.value))}>
              {[12,13,14,15,16,17].map(n => <option key={n}>{n}</option>)}
            </select>
          </label>
        </section>

        {/* Scoring */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Scoring</h3>
          <div className={styles.field}>
            <span>Reception (PPR)</span>
            <div className={styles.radioGroup}>
              {[['0', 'Std'],['0.5', 'Half'],['1', 'Full']].map(([v, label]) => (
                <label key={v} className={styles.radio}>
                  <input type="radio" name="ppr" value={v}
                    checked={settings.ppr === v}
                    onChange={() => update('ppr', v)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <label className={styles.field}>
            <span>Pass TD pts</span>
            <input type="number" step={0.5} value={settings.pass_td}
              onChange={e => update('pass_td', e.target.value)} />
            {validationError.pass_td && <span className={styles.fieldError}>{validationError.pass_td}</span>}
          </label>
          <label className={styles.field}>
            <span>Rush TD pts</span>
            <input type="number" step={0.5} value={settings.rush_td}
              onChange={e => update('rush_td', e.target.value)} />
            {validationError.rush_td && <span className={styles.fieldError}>{validationError.rush_td}</span>}
          </label>
          <label className={styles.field}>
            <span>Rec TD pts</span>
            <input type="number" step={0.5} value={settings.rec_td}
              onChange={e => update('rec_td', e.target.value)} />
            {validationError.rec_td && <span className={styles.fieldError}>{validationError.rec_td}</span>}
          </label>
          <label className={styles.field}>
            <span>Pts / pass yd</span>
            <input type="number" step={0.01} value={settings.pass_yds}
              onChange={e => update('pass_yds', e.target.value)} />
            {validationError.pass_yds && <span className={styles.fieldError}>{validationError.pass_yds}</span>}
          </label>
          <label className={styles.field}>
            <span>Pts / rush yd</span>
            <input type="number" step={0.01} value={settings.rush_yds}
              onChange={e => update('rush_yds', e.target.value)} />
            {validationError.rush_yds && <span className={styles.fieldError}>{validationError.rush_yds}</span>}
          </label>
          <label className={styles.field}>
            <span>Pts / rec yd</span>
            <input type="number" step={0.01} value={settings.rec_yds}
              onChange={e => update('rec_yds', e.target.value)} />
            {validationError.rec_yds && <span className={styles.fieldError}>{validationError.rec_yds}</span>}
          </label>
          <label className={styles.field}>
            <span>Interception pts</span>
            <input type="number" step={0.5} value={settings.interception}
              onChange={e => update('interception', e.target.value)} />
            {validationError.interception && <span className={styles.fieldError}>{validationError.interception}</span>}
          </label>
          <label className={styles.field}>
            <span>Fumble lost pts</span>
            <input type="number" step={0.5} value={settings.fumble_lost}
              onChange={e => update('fumble_lost', e.target.value)} />
            {validationError.fumble_lost && <span className={styles.fieldError}>{validationError.fumble_lost}</span>}
          </label>
          <label className={styles.field}>
            <span>TE premium pts</span>
            <input type="number" step={0.25} value={settings.te_premium}
              onChange={e => update('te_premium', e.target.value)} />
            {validationError.te_premium && <span className={styles.fieldError}>{validationError.te_premium}</span>}
          </label>
        </section>

        {/* Roster */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Starters</h3>
          {[['QB','QB'],['RB','RB'],['WR','WR'],['TE','TE'],['DST','DST'],['K','K']].map(([field, label]) => (
            <label key={field} className={styles.field}>
              <span>{label}</span>
              <input type="number" min={0} max={field === 'QB' ? 3 : 5}
                value={settings[field] as number | string}
                onChange={e => update(field, e.target.value)} />
            </label>
          ))}
          <label className={styles.field}>
            <span>FLEX slots</span>
            <input type="number" min={0} max={3}
              value={settings.flex_slots}
              onChange={e => update('flex_slots', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Bench spots</span>
            <input type="number" min={0} max={20}
              value={settings.bench_spots}
              onChange={e => update('bench_spots', e.target.value)} />
            {validationError.bench_spots && <span className={styles.fieldError}>{validationError.bench_spots}</span>}
          </label>
        </section>

        {/* Flex breakdown */}
        {toInt(settings.flex_slots) > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>FLEX split <span className={styles.hint}>(must sum to 1.0)</span></h3>
            <div className={styles.presetRow}>
              <span className={styles.presetLabel}>Preset:</span>
              <button type="button" className={styles.presetBtn}
                onClick={() => applyFlexPreset({ flex_rb: 0.5, flex_wr: 0.4, flex_te: 0.1, flex_qb: 0.0 })}>
                Standard
              </button>
              <button type="button" className={styles.presetBtn}
                onClick={() => applyFlexPreset({ flex_rb: 0.0, flex_wr: 0.0, flex_te: 0.0, flex_qb: 1.0 })}>
                Superflex
              </button>
            </div>
            {[['flex_rb','RB'],['flex_wr','WR'],['flex_te','TE'],['flex_qb','QB (superflex)']].map(([field, label]) => (
              <label key={field} className={styles.field}>
                <span>{label}</span>
                <input type="number" min={0} max={1} step={0.05}
                  value={settings[field] as number | string}
                  onChange={e => update(field, e.target.value)} />
              </label>
            ))}
            {validationError.flex && <p className={styles.fieldError}>{validationError.flex}</p>}
          </section>
        )}

        {/* Auction */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Auction</h3>
          <label className={styles.field}>
            <span>Auction mode</span>
            <input type="checkbox" checked={settings.auction_mode}
              onChange={e => update('auction_mode', e.target.checked)} />
          </label>
          {settings.auction_mode && (
            <label className={styles.field}>
              <span>Budget ($)</span>
              <input type="number" min={50} max={1000} step={50}
                value={settings.auction_budget}
                onChange={e => update('auction_budget', e.target.value)} />
            </label>
          )}
        </section>

        {/* ECR (optional) */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>ECR <span className={styles.hint}>(optional)</span></h3>
          <label className={styles.keyField}>
            <span>FantasyPros API key</span>
            <input type="password" autoComplete="off" spellCheck={false}
              className={styles.keyInput}
              placeholder="Enables real Expert Consensus Rankings"
              value={fpKey}
              onChange={e => setFpKey(e.target.value)} />
          </label>
          <p className={styles.keyHelp}>
            Optional. With a key, the ECR column uses real FantasyPros consensus
            rankings; without one it falls back to ADP. Get a key at{' '}
            <a href="https://www.fantasypros.com/apis/" target="_blank" rel="noreferrer">fantasypros.com/apis</a>.
            Stored only in this browser tab and sent only to this app&apos;s backend.
          </p>
        </section>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.buttonRow}>
        <button type="submit" className={styles.submitBtn} disabled={loading}>
          {loading ? (
            <span className={styles.spinner}>⟳ Generating sheet…</span>
          ) : (
            '⚡ Generate Draft Sheet'
          )}
        </button>
        <button
          type="button"
          className={styles.clearBtn}
          disabled={clearStatus === 'clearing'}
          onClick={handleClearCache}
        >
          {clearStatus === 'clearing' ? 'Clearing…' :
           clearStatus === 'cleared'  ? '✓ Cleared' :
           clearStatus === 'error'    ? '✗ Failed'  :
           'Clear Cache'}
        </button>
      </div>
    </form>
  )
}
