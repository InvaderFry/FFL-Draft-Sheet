/**
 * App.jsx — BeerSheets MVP
 *
 * State machine:
 *   idle → user fills LeagueForm → loading → ready (DraftBoard shown)
 *                                          ↘ error (message shown, back on the form)
 *
 * A single useDraftState instance is shared by the interactive DraftBoard and
 * the (always-mounted, print-only) PrintView so crossed-off players appear in
 * both the on-screen board and the printed sheet.
 */

import { useState, useCallback } from 'react'
import LeagueForm from './components/LeagueForm'
import DraftBoard from './components/DraftBoard'
import PrintView from './components/PrintView'
import { useDraftState } from './hooks/useDraftState'
import { useTheme } from './context/ThemeContext'
import styles from './App.module.css'

const THEMES = [
  { id: 'dark',      label: 'Dark' },
  { id: 'macchiato', label: 'Macchiato' },
  { id: 'latte',     label: 'Latte' },
]

export default function App() {
  const { theme, setTheme } = useTheme()
  const [phase, setPhase] = useState('idle')  // 'idle' | 'loading' | 'ready'
  const [sheetData, setSheetData] = useState(null)
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)
  const { isDrafted, toggle, count: draftedCount, clear: clearDrafted } = useDraftState()

  const handleSheet = useCallback((data, cfg) => {
    setSheetData(data)
    setConfig(cfg)
    setError(null)
    setPhase('ready')
  }, [])

  const handleLoading = useCallback((isLoading) => {
    if (isLoading) {
      setError(null)
      setPhase('loading')
    }
  }, [])

  const handleError = useCallback((message) => {
    setError(message || 'Failed to generate sheet. Please try again.')
    setPhase('idle')
  }, [])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  const handleReset = useCallback(() => {
    setPhase('idle')
    setSheetData(null)
    setConfig(null)
    setError(null)
    clearDrafted()
  }, [clearDrafted])

  return (
    <div className={styles.app}>
      {/* Site header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <span className={styles.logoEmoji}>🍺</span>
            <span className={styles.logoText}>FFL Draft Sheet</span>
            <span className={styles.logoBadge}>Free VBD</span>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.themeToggle}>
              {THEMES.map(t => (
                <button
                  key={t.id}
                  className={`${styles.themeBtn} ${theme === t.id ? styles.themeBtnActive : ''}`}
                  onClick={() => setTheme(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {phase === 'ready' && (
              <button className={styles.resetBtn} onClick={handleReset}>
                ← New Sheet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={styles.main}>
        {phase === 'idle' && (
          <div className={styles.formWrap}>
            <div className={styles.hero}>
              <h1 className={styles.heroTitle}>Your free, league-customized draft cheat sheet</h1>
              <p className={styles.heroSub}>
                Value-Based Drafting · Man-games baseline · Jenks tiers · Auction values
              </p>
            </div>
            <LeagueForm
              onSheet={handleSheet}
              onLoading={handleLoading}
              onError={handleError}
              error={error}
            />
          </div>
        )}

        {phase === 'loading' && (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <p className={styles.loadingText}>Crunching projections…</p>
            <p className={styles.loadingHint}>Scraping public sources and computing VBD values.</p>
          </div>
        )}

        {phase === 'ready' && sheetData && (
          <div className={styles.boardWrap}>
            <DraftBoard
              sheetData={sheetData}
              config={config}
              onPrint={handlePrint}
              isDrafted={isDrafted}
              onToggle={toggle}
              draftedCount={draftedCount}
              onClearDrafted={clearDrafted}
            />
          </div>
        )}
      </main>

      {/* Always-mounted print view (hidden on screen) */}
      {sheetData && (
        <PrintView
          sheetData={sheetData}
          config={config}
          isDrafted={isDrafted}
        />
      )}
    </div>
  )
}
