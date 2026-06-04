/**
 * U13 — DraftBoard
 *
 * Tab bar (QB / RB / WR / TE / DST / K) + active position's PlayerTable.
 * Draft state is owned by App and passed in as props, so the on-screen board
 * and the print view stay in sync. Switching tabs preserves it.
 */

import { useState } from 'react'
import PlayerTable from './PlayerTable'
import styles from './DraftBoard.module.css'

const TAB_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST']

const POS_COLORS = {
  QB:  '#ef4444',
  RB:  '#22c55e',
  WR:  '#60a5fa',
  TE:  '#f59e0b',
  DST: '#a855f7',
  K:   '#6b7280',
}

export default function DraftBoard({
  sheetData,
  config,
  onPrint,
  isDrafted,
  onToggle: toggle,
  draftedCount: count = 0,
  onClearDrafted: clear,
}) {
  const [activePos, setActivePos] = useState('QB')

  const { positions, metadata } = sheetData
  const players = positions[activePos] || []
  const nTeams = config?.n_teams || 12
  const auctionMode = config?.auction_mode || false

  return (
    <div className={styles.board}>
      {/* Header bar */}
      <div className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.metaTag}>
            {nTeams}-team · {metadata?.ppr === 1 ? 'Full PPR' : metadata?.ppr === 0.5 ? 'Half PPR' : 'Standard'}
          </span>
          {metadata?.sources_used?.length > 0 && (
            <span className={styles.metaTag}>
              {metadata.sources_used.length} source{metadata.sources_used.length !== 1 ? 's' : ''}
            </span>
          )}
          {metadata?.generation_time_s && (
            <span className={styles.metaTag}>
              Generated in {metadata.generation_time_s}s
            </span>
          )}
          {count > 0 && (
            <span className={styles.draftCount}>
              {count} drafted —{' '}
              <button className={styles.clearBtn} onClick={clear}>clear</button>
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <button className={styles.printBtn} onClick={onPrint}>
            🖨 Print Sheet
          </button>
        </div>
      </div>

      {/* Baselines legend */}
      {metadata?.baselines && (
        <div className={styles.baselines}>
          {Object.entries(metadata.baselines)
            .filter(([, v]) => v > 0)
            .map(([pos, pts]) => (
              <span key={pos} className={styles.baselineItem}>
                <span className={styles.baselinePos}>{pos}</span>
                {' '}{pts.toFixed(0)} pts
              </span>
            ))}
        </div>
      )}

      {/* Tab bar */}
      <div className={styles.tabs}>
        {TAB_ORDER.map(pos => {
          const tabCount = positions[pos]?.length || 0
          if (tabCount === 0) return null
          return (
            <button
              key={pos}
              className={`${styles.tab} ${activePos === pos ? styles.tabActive : ''}`}
              style={activePos === pos ? { borderBottomColor: POS_COLORS[pos] } : {}}
              onClick={() => setActivePos(pos)}
            >
              <span className={styles.tabPos}>{pos}</span>
              <span className={styles.tabCount}>{tabCount}</span>
            </button>
          )
        })}
      </div>

      {/* Player table */}
      <PlayerTable
        key={activePos}
        players={players}
        nTeams={nTeams}
        isDrafted={isDrafted}
        onToggle={toggle}
        auctionMode={auctionMode}
      />
    </div>
  )
}
