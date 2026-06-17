/**
 * U13 — DraftBoard
 *
 * Tab bar (QB / RB / WR / TE / DST / K) + active position's PlayerTable.
 * Draft state is owned by App and passed in as props, so the on-screen board
 * and the print view stay in sync. Switching tabs preserves it.
 */

import { useState, useMemo, useEffect } from 'react'
import PlayerTable from './PlayerTable'
import CombinedView from './CombinedView'
import DraftedPanel from './DraftedPanel'
import DraftSync from './DraftSync'
import Legend from './Legend'
import { TIER_METHODS, methodAvailable } from '../utils/tierAccess'
import { useTheme } from '../context/ThemeContext'
import { downloadCsv, toCsv } from '../utils/exportCsv'
import { valRangeFromPositions } from '../utils/valGradient'
import {
  currentOverall,
  nextUserPickOverall,
  positionRunsSinceLastPick,
  rosterNeeds,
} from '../utils/draftStrategy'
import { recommendPicks } from '../utils/recommendations'
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
      positionCounts: entry.position_counts || {},
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
    positionCounts: {},
    reason: null,
    failures: [],
  }))
  const unavailable = (metadata?.sources_dropped || []).map((source) => ({
    source,
    status: 'unavailable',
    used: false,
    positions: [],
    positionCounts: {},
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

// "QB 60 · RB 120 · WR 140" when row counts are present, else the plain
// position list ("QB, RB, WR"). Order follows the positions array.
function formatPositions(entry) {
  const counts = entry.positionCounts || {}
  if (entry.positions.length === 0) return ''
  const hasCounts = entry.positions.some((pos) => counts[pos] != null)
  if (!hasCounts) return entry.positions.join(', ')
  return entry.positions
    .map((pos) => (counts[pos] != null ? `${pos} ${counts[pos]}` : pos))
    .join(' · ')
}

// A short note on ADP availability / prior-season fallback for the panel.
function adpStatusNote(metadata) {
  if (metadata?.adp_available === false) return 'ADP unavailable'
  const { adp_season: adpSeason, season } = metadata || {}
  if (adpSeason && season && adpSeason !== season) {
    return `ADP from ${adpSeason} — ${season} not yet published`
  }
  return null
}

export default function DraftBoard({
  sheetData,
  config,
  onPrint,
  isDrafted,
  onToggle: toggle,
  draftedCount: count = 0,
  onClearDrafted: clear,
  onRemoveDrafted,
  draftedList = [],
  espnSync = null,
  isWatched = () => false,
  toggleWatch = () => {},
  shadeBy = 'jenks',
  setShadeBy = () => {},
  linesBy = 'none',
  setLinesBy = () => {},
  manualTiers = null,
  hasManual = false,
  onSeedManual = () => {},
  onToggleBoundary = () => {},
}) {
  const { posColors } = useTheme()
  const [activePos, setActivePos] = useState('ALL')
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [watchedOnly, setWatchedOnly] = useState(false)
  const [thinMode, setThinMode] = useState(
    () => localStorage.getItem('ffl_thin_mode') === '1'
  )

  useEffect(() => {
    localStorage.setItem('ffl_thin_mode', thinMode ? '1' : '0')
  }, [thinMode])

  const { positions, metadata } = sheetData

  // Which methods can be selected. Manual is always selectable (selecting it
  // seeds from the active method); Jenks/None are always available; computed
  // methods (GMM, Boris Chen) only when the sheet carries their data.
  const availableMethods = useMemo(() => {
    const map = {}
    for (const m of TIER_METHODS) {
      map[m.id] = m.id === 'manual' ? true : methodAvailable(positions, m.id, manualTiers)
    }
    return map
  }, [positions, manualTiers])

  // Fall back to Jenks/None if a persisted selection isn't available this sheet
  // (manual is exempt — it is always selectable and self-seeds).
  useEffect(() => {
    if (shadeBy !== 'jenks' && shadeBy !== 'manual' && !availableMethods[shadeBy]) setShadeBy('jenks')
  }, [availableMethods, shadeBy, setShadeBy])
  useEffect(() => {
    if (linesBy !== 'none' && linesBy !== 'manual' && !availableMethods[linesBy]) setLinesBy('none')
  }, [availableMethods, linesBy, setLinesBy])

  const manualEdit = shadeBy === 'manual' || linesBy === 'manual'

  // Selecting Manual seeds boundaries from the other channel's method (or Jenks)
  // when none exist yet, so the user starts from a sensible tiering.
  const selectMethod = (setter, value) => {
    if (value === 'manual' && !hasManual) {
      const seed = [shadeBy, linesBy].find(m => m && m !== 'manual' && m !== 'none') || 'jenks'
      onSeedManual(positions, seed)
    }
    setter(value)
  }

  const players = positions[activePos] || []
  const nTeams = config?.n_teams || 12
  const auctionMode = config?.auction_mode || false
  const sourceDetails = useMemo(() => buildSourceDetails(metadata), [metadata])
  const { minVal, maxVal } = useMemo(
    () => valRangeFromPositions(positions),
    [positions]
  )
  const playersById = useMemo(() => {
    const lookup = new Map()
    for (const rows of Object.values(positions)) {
      for (const player of rows) {
        lookup.set(player.sleeper_id || player.player_name, player)
      }
    }
    return lookup
  }, [positions])
  const sourceCount = sourceDetails.used.length

  // Strategy tools need a chosen "My Team". Roster needs/byes are useful in any
  // format and after the draft ends; next-pick, runs, and the per-row survival
  // markers are snake-only, so they're gated to a *live snake* draft (no auction,
  // not yet complete) to avoid showing confidently-wrong advice.
  const myTeamId = espnSync?.myTeamId || null
  const rosterActive = !!myTeamId &&
    (espnSync?.status === 'connected' || espnSync?.status === 'complete')
  const snakeLive = !!myTeamId && espnSync?.status === 'connected' && !auctionMode
  const myTeamPicks = useMemo(() => {
    if (!myTeamId) return []
    return draftedList
      .filter(p => p.teamId === myTeamId)
      .sort((a, b) => (a.overall ?? Number.MAX_SAFE_INTEGER) - (b.overall ?? Number.MAX_SAFE_INTEGER))
  }, [draftedList, myTeamId])

  const strategy = useMemo(() => {
    if (!rosterActive) return null
    return {
      currentPick: snakeLive ? currentOverall(draftedList) : null,
      nextPick: snakeLive ? nextUserPickOverall(draftedList, myTeamId, nTeams) : null,
      runs: snakeLive ? positionRunsSinceLastPick(draftedList, myTeamId, nTeams) : null,
      needs: rosterNeeds(myTeamPicks, config, id => playersById.get(id)?.bye_week),
    }
  }, [rosterActive, snakeLive, draftedList, myTeamId, nTeams, myTeamPicks, playersById, config])

  // The per-row survival marker only needs the two pick numbers.
  const tableStrategy = strategy && strategy.nextPick != null
    ? { currentPick: strategy.currentPick, nextPick: strategy.nextPick }
    : null

  // "Who do I draft now?" — composes VAL + scarcity + roster needs + survival
  // into a ranked shortlist. Degrades gracefully: best-available before a team
  // is chosen, need-weighted once it is, survival-urgent once the draft is live.
  // isDrafted changes identity on every pick, so the list refreshes as players
  // come off the board.
  const recommendations = useMemo(
    () => recommendPicks({
      positions,
      isDrafted,
      needs: strategy?.needs ?? null,
      currentPick: strategy?.currentPick ?? null,
      nextPick: strategy?.nextPick ?? null,
      config,
    }),
    [positions, isDrafted, strategy, config]
  )

  const handleExportCsv = () => {
    const headers = ['Overall', 'Pos', 'Player', 'Team', 'Bye', 'Value']
    const rows = myTeamPicks.map((pick) => {
      const player = playersById.get(pick.id)
      return [
        pick.overall ?? '',
        pick.pos || player?.pos || '',
        pick.name || player?.player_name || '',
        player?.team || '',
        player?.bye_week ?? '',
        player?.val ?? '',
      ]
    })
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(`draft-roster-${date}.csv`, toCsv(headers, rows))
  }

  return (
    <div className={styles.board}>
      {/* Header bar */}
      <div className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.metaTag}>
            {nTeams}-team · {metadata?.ppr === 1 ? 'Full PPR' : metadata?.ppr === 0.5 ? 'Half PPR' : 'Standard'}
          </span>
          {metadata?.ecr_available === false && (
            <span
              className={styles.metaTag}
              title="FantasyPros ECR is unavailable (no API key or not yet published), so the ECR column is approximated from ADP."
            >
              ECR: ADP proxy
            </span>
          )}
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
                              <div className={styles.sourceMeta}>{formatPositions(entry)}</div>
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

                  {(adpStatusNote(metadata) || (metadata?.data_quality_warnings?.length > 0)) && (
                    <div className={styles.sourceSection}>
                      <div className={styles.sourceSectionTitle}>Diagnostics</div>
                      <ul className={styles.warningList}>
                        {adpStatusNote(metadata) && (
                          <li key="adp-status">{adpStatusNote(metadata)}</li>
                        )}
                        {(metadata?.data_quality_warnings || []).map((warning) => (
                          <li key={warning}>{warning}</li>
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
          {espnSync && <DraftSync espnSync={espnSync} defaultSeason={metadata?.season} />}
          {count > 0 && (
            <span className={styles.draftCount}>
              {count} drafted —{' '}
              <button type="button" className={styles.clearBtn} onClick={clear}>clear</button>
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <div className={styles.filters}>
            <input
              type="search"
              className={styles.searchInput}
              aria-label="Search players"
              placeholder="Search players"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              className={`${styles.watchToggle} ${watchedOnly ? styles.watchToggleActive : ''}`}
              aria-pressed={watchedOnly}
              onClick={() => setWatchedOnly(active => !active)}
            >
              ★ only
            </button>
            <button
              type="button"
              className={`${styles.watchToggle} ${thinMode ? styles.watchToggleActive : ''}`}
              aria-pressed={thinMode}
              title="Thin mode — hide Team/Bye and Floor columns for a narrower table"
              onClick={() => setThinMode(active => !active)}
            >
              Thin
            </button>
            <label className={styles.tierControl}>
              <span className={styles.tierControlLabel}>Shade</span>
              <select
                className={styles.tierSelect}
                aria-label="Shade tiers by method"
                value={shadeBy}
                onChange={(event) => selectMethod(setShadeBy, event.target.value)}
              >
                {TIER_METHODS.map(m => (
                  <option key={m.id} value={m.id} disabled={!availableMethods[m.id]}>
                    {m.label}{availableMethods[m.id] ? '' : ' (n/a)'}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.tierControl}>
              <span className={styles.tierControlLabel}>Lines</span>
              <select
                className={styles.tierSelect}
                aria-label="Tier boundary lines by method"
                value={linesBy}
                onChange={(event) => selectMethod(setLinesBy, event.target.value)}
              >
                <option value="none">None</option>
                {TIER_METHODS.map(m => (
                  <option key={m.id} value={m.id} disabled={!availableMethods[m.id]}>
                    {m.label}{availableMethods[m.id] ? '' : ' (n/a)'}
                  </option>
                ))}
              </select>
            </label>
            {manualEdit && (
              <button
                type="button"
                className={styles.watchToggle}
                title="Re-seed manual tiers from the other selected method"
                onClick={() => {
                  const seed = [shadeBy, linesBy].find(m => m && m !== 'manual' && m !== 'none') || 'jenks'
                  onSeedManual(positions, seed)
                }}
              >
                ⟳ reset tiers
              </button>
            )}
          </div>
          {myTeamPicks.length > 0 && (
            <button type="button" className={styles.printBtn} onClick={handleExportCsv}>
              Export CSV
            </button>
          )}
          <button type="button" className={styles.printBtn} onClick={onPrint}>
            Print Sheet
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
      <Legend auctionMode={auctionMode} thinMode={thinMode} shadeBy={shadeBy} linesBy={linesBy} manualEdit={manualEdit} />

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
              minVal={minVal}
              maxVal={maxVal}
              strategy={tableStrategy}
              search={search}
              watchedOnly={watchedOnly}
              isWatched={isWatched}
              toggleWatch={toggleWatch}
              shadeBy={shadeBy}
              linesBy={linesBy}
              manualTiers={manualTiers}
              manualEdit={manualEdit}
              onToggleBoundary={onToggleBoundary}
              thinMode={thinMode}
            />
          ) : (
            <PlayerTable
              key={activePos}
              players={players}
              nTeams={nTeams}
              isDrafted={isDrafted}
              onToggle={toggle}
              auctionMode={auctionMode}
              minVal={minVal}
              maxVal={maxVal}
              strategy={tableStrategy}
              search={search}
              watchedOnly={watchedOnly}
              isWatched={isWatched}
              toggleWatch={toggleWatch}
              shadeBy={shadeBy}
              linesBy={linesBy}
              manualTiers={manualTiers}
              manualEdit={manualEdit}
              onToggleBoundary={onToggleBoundary}
              thinMode={thinMode}
              wrapStyle={{ height: '100%', maxHeight: 'none', overflow: 'auto', flex: 1 }}
            />
          )}
        </div>
        <DraftedPanel
          draftedList={draftedList}
          onToggle={toggle}
          onRemove={onRemoveDrafted}
          myTeamId={espnSync?.myTeamId}
          syncActive={espnSync?.status === 'connected' || espnSync?.status === 'connecting'}
          needs={strategy?.needs}
          runs={strategy?.runs}
          nextPick={strategy?.nextPick}
          recommendations={recommendations}
        />
      </div>
    </div>
  )
}
