/**
 * App.jsx — BeerSheets MVP
 *
 * State machine:
 *   idle    → user fills LeagueForm → loading → success (DraftBoard shown) | error
 *
 * PrintView is always rendered (but hidden) so window.print() captures it.
 */

import { useState, useCallback } from 'react'
import LeagueForm from './components/LeagueForm'
import DraftBoard from './components/DraftBoard'
import PrintView from './components/PrintView'
import { useDraftState } from './hooks/useDraftState'
import styles from './App.module.css'

export default function App() {
  const [phase, setPhase] = useState('idle')  // 'idle' | 'loading' | 'ready'
  const [sheetData, setSheetData] = useState(null)
  const [config, setConfig] = useState(null)
  const { isDrafted, toggle } = useDraftState()

  const handleSheet = useCallback((data, cfg) => {
    setSheetData(data)
    setConfig(cfg)
    setPhase('ready')
  }, [])

  const handleLoading = useCallback((isLoading) => {
    if (isLoading) setPhase('loading')
  }, [])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  const handleReset = useCallback(() => {
    setPhase('idle')
    setSheetData(null)
  }, [])

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
          {phase === 'ready' && (
            <button className={styles.resetBtn} onClick={handleReset}>
              ← New Sheet
            </button>
          )}
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
            <LeagueForm onSheet={handleSheet} onLoading={handleLoading} />
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
