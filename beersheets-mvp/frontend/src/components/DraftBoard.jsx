/**
 * U13 — DraftBoard
 *
 * Tab bar (QB / RB / WR / TE / DST / K) + active position's PlayerTable.
 * Draft state is owned by App and passed in as props, so the on-screen board
 * and the print view stay in sync. Switching tabs preserves it.
 */

import { useState, useMemo } from 'react'
import PlayerTable from './PlayerTable'
import CombinedView from './CombinedView'
import DraftedPanel from './DraftedPanel'
import Legend from './Legend'
import { useTheme } from '../context/ThemeContext'
import styles from './DraftBoard.module.css'

const TAB_ORDER = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DST']

function buildSourceDetails(metadata) {
  const richStatuses = Array.isArray(metadata?.source_statuses) ? metadata.source_statuses : []
  if (richStatuses.length > 0) {
    const entries = richStatuses.map((entry) => ({
      source: entry.source,
      status: entry.status || (entry.used ? 'used' : 'unavailable'),
      used: entry.used || entry.status === 'used' || entry.status === 'partial',
      positions: entry.positions || [],
      reason: entry.reason || entry.failures?.[0]?.reason || null,
      failures: entry.failures || [],
    }))

    return {
      hasDetails: entries.length > 0,
      used: entries.filter((entry) => entry.used),
      unavailable: entries.filter((entry) => !entry.used),
    }
  }

  const used = (metadata?.sources_used || []).map((source) => ({
    source,
    status: 'used',
    used: true,
    positions: [],
    reason: null,
    failures: [],
  }))
  const unavailable = (metadata?.sources_dropped || []).map((source) => ({
    source,
    status: 'unavailable',
    used: false,
    positions: [],
    reason: null,
    failures: [],
  }))

  return {
    hasDetails: used.length > 0 || unavailable.length > 0,
    used,
    unavailable,
  }
}

function sourceCountLabel(count) {
  return `${count} source${count !== 1 ? 's' : ''}`
}

export default function DraftBoard({
  sheetData,
  config,
  onPrint,
  isDrafted,
  onToggle: toggle,
  draftedCount: count = 0,
  onClearDrafted: clear,
  draftedList = [],
}) {
  const { posColors } = useTheme()
  const [activePos, setActivePos] = useState('ALL')
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false)

  const { positions, metadata } = sheetData
  const players = positions[activePos] || []
  const nTeams = config?.n_teams || 12
  const auctionMode = config?.auction_mode || false
  const sourceDetails = useMemo(() => buildSourceDetails(metadata), [metadata])
  const sourceCount = sourceDetails.used.length

  return (
    <div className={styles.board}>
      {/* Header bar */}
      <div className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.metaTag}>
            {nTeams}-team · {metadata?.ppr === 1 ? 'Full PPR' : metadata?.ppr === 0.5 ? 'Half PPR' : 'Standard'}
          </span>
          {sourceDetails.hasDetails && (
            <div className={styles.sourceWrap}>
              <button
                type="button"
                className={`${styles.metaTag} ${styles.sourceButton}`}
                aria-expanded={sourceDetailsOpen}
                aria-controls="source-details-panel"
                onClick={() => setSourceDetailsOpen((open) => !open)}
              >
                {sourceCountLabel(sourceCount)}
              </button>
              {sourceDetailsOpen && (
                <div
                  id="source-details-panel"
                  className={styles.sourcePanel}
                  role="region"
                  aria-label="Source details"
                >
                  <div className={styles.sourcePanelHeader}>
                    <span>Source details</span>
                    <button
                      type="button"
                      className={styles.sourceClose}
                      onClick={() => setSourceDetailsOpen(false)}
                    >
                      Close
                    </button>
                  </div>

                  <div className={styles.sourceSection}>
                    <div className={styles.sourceSectionTitle}>Used</div>
                    {sourceDetails.used.length > 0 ? (
                      <ul className={styles.sourceList}>
                        {sourceDetails.used.map((entry) => (
                          <li key={entry.source} className={styles.sourceItem}>
                            <div className={styles.sourceLine}>
                              <span className={styles.sourceName}>{entry.source}</span>
                              {entry.status === 'partial' && (
                                <span className={styles.partialPill}>Partial</span>
                              )}
                            </div>
                            {entry.positions.length > 0 && (
                              <div className={styles.sourceMeta}>{entry.positions.join(', ')}</div>
                            )}
                            {entry.failures.length > 0 && (
                              <ul className={styles.warningList}>
                                {entry.failures.map((failure) => (
                                  <li key={`${entry.source}-${failure.position}-${failure.reason}`}>
                                    {failure.position}: {failure.reason}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.emptySourceText}>No sources contributed rows.</p>
                    )}
                  </div>

                  {sourceDetails.unavailable.length > 0 && (
                    <div className={styles.sourceSection}>
                      <div className={styles.sourceSectionTitle}>Unavailable</div>
                      <ul className={styles.sourceList}>
                        {sourceDetails.unavailable.map((entry) => (
                          <li key={entry.source} className={styles.sourceItem}>
                            <div className={styles.sourceLine}>
                              <span className={styles.sourceName}>{entry.source}</span>
                              {entry.reason && (
                                <span className={styles.reasonText}>{entry.reason}</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
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
          if (pos === 'ALL') {
            const hasSkillPositions = ['QB', 'RB', 'WR', 'TE'].some(p =>
              (positions[p] || []).some(player => !isDrafted(player.sleeper_id || player.player_name))
            )
            if (!hasSkillPositions) return null
            return (
              <button
                key="ALL"
                className={`${styles.tab} ${activePos === 'ALL' ? styles.tabActive : ''}`}
                style={activePos === 'ALL' ? { borderBottomColor: posColors.ALL } : {}}
                onClick={() => setActivePos('ALL')}
              >
                <span className={styles.tabPos}>ALL</span>
              </button>
            )
          }
          const tabCount = (positions[pos] || []).filter(p => !isDrafted(p.sleeper_id || p.player_name)).length
          if (tabCount === 0) return null
          return (
            <button
              key={pos}
              className={`${styles.tab} ${activePos === pos ? styles.tabActive : ''}`}
              style={activePos === pos ? { borderBottomColor: posColors[pos] } : {}}
              onClick={() => setActivePos(pos)}
            >
              <span className={styles.tabPos}>{pos}</span>
              <span className={styles.tabCount}>{tabCount}</span>
            </button>
          )
        })}
      </div>

      {/* Column legend */}
      <Legend auctionMode={auctionMode} />

      {/* Player table + drafted panel */}
      <div className={styles.contentRow}>
        <div className={styles.tableArea}>
          {activePos === 'ALL' ? (
            <CombinedView
              positions={positions}
              nTeams={nTeams}
              isDrafted={isDrafted}
              onToggle={toggle}
              auctionMode={auctionMode}
            />
          ) : (
            <PlayerTable
              key={activePos}
              players={players}
              nTeams={nTeams}
              isDrafted={isDrafted}
              onToggle={toggle}
              auctionMode={auctionMode}
              wrapStyle={{ height: '100%', maxHeight: 'none', overflow: 'auto', flex: 1 }}
            />
          )}
        </div>
        <DraftedPanel draftedList={draftedList} onToggle={toggle} />
      </div>
    </div>
  )
}
