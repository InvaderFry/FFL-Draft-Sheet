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

import { useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import LeagueForm from './components/LeagueForm'
import DraftBoard from './components/DraftBoard'
import PrintView from './components/PrintView'
import { useDraftState } from './hooks/useDraftState'
import { useWatchlist } from './hooks/useWatchlist'
import { useEspnDraftSync } from './hooks/useEspnDraftSync'
import { useSleeperDraftSync } from './hooks/useSleeperDraftSync'
import { useTierDisplay } from './hooks/useTierDisplay'
import { useManualTiers } from './hooks/useManualTiers'
import { deriveManualTiers } from './utils/tierAccess'
import { useTheme } from './context/ThemeContext'
import styles from './App.module.css'

const THEMES = [
  { id: 'mocha', label: 'Mocha' },
  { id: 'latte', label: 'Latte' },
]

export default function App() {
  const { theme, setTheme } = useTheme()
  const [phase, setPhase] = useState('idle')  // 'idle' | 'loading' | 'ready'
  const [sheetData, setSheetData] = useState(null)
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)
  const { isDrafted, toggle, applySyncedPicks, count: draftedCount, clear: clearDrafted, remove: removeDrafted, draftedList } = useDraftState()
  const { isWatched, toggle: toggleWatch } = useWatchlist()
  const { shadeBy, setShadeBy, linesBy, setLinesBy } = useTierDisplay()
  const { boundaries, seedFromMethod, toggleBoundary, clear: clearManual, hasManual } = useManualTiers(config)
  // Derived id→tier map from the full position lists, shared by board + print.
  const manualTiers = useMemo(
    () => deriveManualTiers(sheetData?.positions || {}, boundaries),
    [sheetData, boundaries]
  )
  // ESPN and Sleeper share the single drafted-state store; only one connects
  // at a time (DraftSync enforces this), so both feed applySyncedPicks safely.
  const espnSync = useEspnDraftSync({ sheetData, applySyncedPicks })
  const sleeperSync = useSleeperDraftSync({ sheetData, applySyncedPicks })
  // Destructured so hooks below can depend on the stable callback instead of
  // the sync objects, which are recreated every render.
  const { disconnect: espnDisconnect } = espnSync
  const { disconnect: sleeperDisconnect } = sleeperSync
  const synced = espnSync.status !== 'disconnected' || sleeperSync.status !== 'disconnected'

  // The board's "clear" wipes manual marks; synced picks survive while a
  // sync session exists, because once polling has stopped (draft complete,
  // permanent error) they would not re-hydrate.
  const handleClearDrafted = useCallback(() => {
    clearDrafted({ keepSynced: synced })
  }, [clearDrafted, synced])

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
    // Browsers render the document title in the print header. Blank it for the
    // print job (restored on afterprint) so the printed sheet has no title text.
    const originalTitle = document.title
    const restore = () => {
      document.title = originalTitle
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    document.title = ''
    window.print()
  }, [])

  const handleReset = useCallback(() => {
    setPhase('idle')
    setSheetData(null)
    setConfig(null)
    setError(null)
    clearDrafted()
    espnDisconnect()
    sleeperDisconnect()
  }, [clearDrafted, espnDisconnect, sleeperDisconnect])

  return (
    <div className={styles.app}>
      {/* Site header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <span className={styles.logoEmoji}>🏈</span>
            <span className={styles.logoText}>Zach&apos;s FFL Draft Sheet</span>
            <span className={styles.logoBadge}>🏆</span>
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
              onClearDrafted={handleClearDrafted}
              onRemoveDrafted={removeDrafted}
              draftedList={draftedList}
              espnSync={espnSync}
              sleeperSync={sleeperSync}
              isWatched={isWatched}
              toggleWatch={toggleWatch}
              shadeBy={shadeBy}
              setShadeBy={setShadeBy}
              linesBy={linesBy}
              setLinesBy={setLinesBy}
              manualTiers={manualTiers}
              hasManual={hasManual}
              onSeedManual={seedFromMethod}
              onToggleBoundary={toggleBoundary}
              onClearManual={clearManual}
            />
          </div>
        )}
      </main>

      {/* Portaled to body so hiding #root in @media print does not suppress it. */}
      {sheetData && typeof document !== 'undefined' && document.body && createPortal(
        <PrintView
          sheetData={sheetData}
          config={config}
          isDrafted={isDrafted}
          shadeBy={shadeBy}
          linesBy={linesBy}
          manualTiers={manualTiers}
        />,
        document.body
      )}
    </div>
  )
}
