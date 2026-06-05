/**
 * U12 — League settings form
 *
 * Collects league configuration and calls POST /api/sheet.
 * Persists last-used settings in localStorage for convenience.
 */

import { useState, useEffect, useRef } from 'react'
import styles from './LeagueForm.module.css'

const API_URL = import.meta.env.VITE_API_URL || ''
const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

const DEFAULT_SETTINGS = {
  n_teams: 12,
  fantasy_weeks: 14,
  QB: 1, RB: 2, WR: 3, TE: 1, DST: 1, K: 0,
  flex_slots: 1,
  flex_rb: 0.5, flex_wr: 0.4, flex_te: 0.1, flex_qb: 0.0,
  ppr: '0.5',     // UI-only; maps to scoring.rec below
  auction_mode: false,
  auction_budget: 200,
}

function pprToRec(ppr) {
  const n = parseFloat(ppr)
  return isNaN(n) ? 0.5 : n
}

function loadSaved() {
  try {
    const raw = localStorage.getItem('beersheet_settings')
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch (_) {}
  return DEFAULT_SETTINGS
}

export default function LeagueForm({ onSheet, onLoading, onError, error }) {
  const [settings, setSettings] = useState(loadSaved)
  const [loading, setLoading] = useState(false)
  const [validationError, setValidationError] = useState({})
  const [clearStatus, setClearStatus] = useState(null) // null | 'clearing' | 'cleared' | 'error'
  const clearTimerRef = useRef(null)

  // Persist settings
  useEffect(() => {
    try { localStorage.setItem('beersheet_settings', JSON.stringify(settings)) } catch (_) {}
  }, [settings])

  // Cancel any pending clear-status reset on unmount to avoid setState on detached instance
  useEffect(() => {
    return () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current) }
  }, [])

  function update(field, value) {
    setSettings(s => ({ ...s, [field]: value }))
    setValidationError(e => ({ ...e, [field]: undefined }))
  }

  function validate() {
    const errs = {}
    if (settings.n_teams < 8 || settings.n_teams > 16)
      errs.n_teams = 'Teams must be 8–16'
    if (settings.fantasy_weeks < 10 || settings.fantasy_weeks > 18)
      errs.fantasy_weeks = 'Weeks must be 10–18'
    const flexSum = parseFloat(settings.flex_rb) + parseFloat(settings.flex_wr) + parseFloat(settings.flex_te) + parseFloat(settings.flex_qb)
    if (Math.abs(flexSum - 1.0) > 0.01)
      errs.flex = `Flex allocations must sum to 1.0 (currently ${flexSum.toFixed(2)})`
    return errs
  }

  async function handleClearCache() {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    setClearStatus('clearing')
    const headers = {}
    if (ADMIN_SECRET) headers['X-Admin-Token'] = ADMIN_SECRET
    try {
      const res = await fetch(`${API_URL}/api/cache/clear`, { method: 'POST', headers })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      setClearStatus('cleared')
    } catch (_) {
      setClearStatus('error')
    } finally {
      clearTimerRef.current = setTimeout(() => setClearStatus(null), 3000)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setValidationError(errs); return }

    const rec = pprToRec(settings.ppr)
    const payload = {
      season: 2026,
      n_teams: parseInt(settings.n_teams),
      fantasy_weeks: parseInt(settings.fantasy_weeks),
      QB: parseInt(settings.QB),
      RB: parseInt(settings.RB),
      WR: parseInt(settings.WR),
      TE: parseInt(settings.TE),
      DST: parseInt(settings.DST),
      K: parseInt(settings.K),
      flex_slots: parseInt(settings.flex_slots),
      flex_rb: parseFloat(settings.flex_rb),
      flex_wr: parseFloat(settings.flex_wr),
      flex_te: parseFloat(settings.flex_te),
      flex_qb: parseFloat(settings.flex_qb),
      auction_mode: settings.auction_mode,
      auction_budget: parseInt(settings.auction_budget),
      scoring: { rec },
    }

    setLoading(true)
    onLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `Server error ${res.status}`)
      }
      const data = await res.json()
      onSheet(data, payload)
    } catch (err) {
      // Surface the error to App, which keeps the form mounted so the message
      // is actually shown (and the user can retry) instead of hanging on the
      // loading spinner.
      onError(err.message || 'Failed to generate sheet. Please try again.')
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
          <div className={styles.field}>
            <span>Scoring</span>
            <div className={styles.radioGroup}>
              {[['0', 'Standard'],['0.5', 'Half-PPR'],['1', 'Full PPR']].map(([v, label]) => (
                <label key={v} className={styles.radio}>
                  <input type="radio" name="ppr" value={v}
                    checked={settings.ppr === v}
                    onChange={() => update('ppr', v)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Roster */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Starters</h3>
          {[['QB','QB'],['RB','RB'],['WR','WR'],['TE','TE'],['DST','DST'],['K','K']].map(([field, label]) => (
            <label key={field} className={styles.field}>
              <span>{label}</span>
              <input type="number" min={0} max={field === 'QB' ? 3 : 5}
                value={settings[field]}
                onChange={e => update(field, e.target.value)} />
            </label>
          ))}
          <label className={styles.field}>
            <span>FLEX slots</span>
            <input type="number" min={0} max={3}
              value={settings.flex_slots}
              onChange={e => update('flex_slots', e.target.value)} />
          </label>
        </section>

        {/* Flex breakdown */}
        {parseInt(settings.flex_slots) > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>FLEX split <span className={styles.hint}>(must sum to 1.0)</span></h3>
            {[['flex_rb','RB'],['flex_wr','WR'],['flex_te','TE'],['flex_qb','QB (superflex)']].map(([field, label]) => (
              <label key={field} className={styles.field}>
                <span>{label}</span>
                <input type="number" min={0} max={1} step={0.05}
                  value={settings[field]}
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
