import { STARTER_POS } from '../utils/draftStrategy'
import type { DraftedEntry, RosterNeeds } from '../types/domain'
import type { Recommendation } from '../utils/recommendations'
import type { ToggleFn } from '../types/components'
import styles from './DraftedPanel.module.css'

interface StrategyBlockProps {
  needs: RosterNeeds | null
  runs: Record<string, number> | null
  nextPick: number | null
}

// Compact roster-needs + run-alert block shown under MY TEAM during a live
// draft. Renders nothing useful until there's strategy data to show.
function StrategyBlock({ needs, runs, nextPick }: StrategyBlockProps) {
  if (!needs && !runs && nextPick == null) return null

  const runEntries = runs
    ? Object.entries(runs).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className={styles.strategy}>
      {nextPick != null && (
        <div className={styles.nextPick}>Your next pick: <strong>#{nextPick}</strong></div>
      )}
      {needs && (
        <div className={styles.needsGrid}>
          {STARTER_POS.map(pos => {
            const slot = needs.positions[pos]
            if (!slot || slot.need === 0) return null
            const done = slot.filled >= slot.need
            return (
              <span key={pos} className={`${styles.needChip} ${done ? styles.needChipDone : ''}`}>
                {pos} {slot.filled}/{slot.need}
              </span>
            )
          })}
          {needs.flex.need > 0 && (
            <span className={`${styles.needChip} ${needs.flex.filled >= needs.flex.need ? styles.needChipDone : ''}`}>
              FLX {needs.flex.filled}/{needs.flex.need}
            </span>
          )}
        </div>
      )}
      {runEntries.length > 0 && (
        <div className={styles.runLine}>
          Since your last pick: {runEntries.map(([pos, n]) => `${n} ${pos}`).join(', ')} off the board
        </div>
      )}
      {needs?.byeConflicts?.map(c => (
        <div key={c.week} className={styles.byeWarn}>
          ⚠ {c.count} starters on bye wk {c.week}
        </div>
      ))}
    </div>
  )
}

interface RecommendedBlockProps {
  recommendations: Recommendation[]
  onToggle: ToggleFn
}

// Ranked best-pick shortlist shown at the top of the panel. Each row marks the
// player drafted on click (same as a manual pick), with the full reasoning in
// the tooltip. Renders nothing when there are no recommendations.
function RecommendedBlock({ recommendations, onToggle }: RecommendedBlockProps) {
  if (!recommendations || recommendations.length === 0) return null
  return (
    <>
      <div className={styles.header}>RECOMMENDED</div>
      <ul className={`${styles.list} ${styles.recList}`}>
        {recommendations.map(({ player, reasons }, idx) => {
          const id = player.sleeper_id || player.player_name
          return (
            <li
              key={id}
              className={`${styles.item} ${styles.recItem}`}
              onClick={() => onToggle(id, player.player_name, player.pos)}
              title={`${reasons.all.join(' · ')} — click to mark drafted`}
            >
              <div className={styles.recName}>
                <span className={styles.recRank}>{idx + 1}</span>
                {player.player_name} <span className={styles.pos}>{player.pos}</span>
              </div>
              <div className={styles.recReason}>{reasons.primary}</div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

interface PickItemProps {
  pick: DraftedEntry
  onToggle: ToggleFn
  onRemove: (id: string) => void
  syncActive: boolean
}

function PickItem({ pick, onToggle, onRemove, syncActive }: PickItemProps) {
  const { id, name, pos, source, teamName } = pick
  const synced = source === 'espn'
  // While sync is live, removing a synced pick is futile (it re-hydrates on
  // the next poll) — undo it in the draft room. Once polling has stopped
  // (disconnected/complete/error), removal is the only escape hatch for a
  // mismapped or commissioner-reversed pick, so allow it.
  const locked = synced && syncActive
  const handleClick = locked
    ? undefined
    : synced
      ? () => onRemove(id)
      : () => onToggle(id, name, pos)
  return (
    <li
      className={`${styles.item} ${locked ? styles.itemSynced : ''}`}
      onClick={handleClick}
      title={locked
        ? 'Synced from ESPN — undo in your draft room'
        : synced ? 'Click to remove' : 'Click to undo draft'}
    >
      <div className={styles.itemName}>
        {name} <span className={styles.pos}>{pos}</span>
      </div>
      {synced && teamName && <div className={styles.team}>{teamName}</div>}
    </li>
  )
}

interface DraftedPanelProps {
  draftedList: DraftedEntry[]
  onToggle: ToggleFn
  onRemove?: (id: string) => void
  myTeamId?: string | null
  syncActive?: boolean
  needs?: RosterNeeds | null
  runs?: Record<string, number> | null
  nextPick?: number | null
  recommendations?: Recommendation[]
}

export default function DraftedPanel({
  draftedList, onToggle, onRemove = () => {}, myTeamId = null, syncActive = false,
  needs = null, runs = null, nextPick = null, recommendations = [],
}: DraftedPanelProps) {
  const myPicks = myTeamId
    ? draftedList
        .filter(p => p.teamId === myTeamId)
        .sort((a, b) => (a.overall || 0) - (b.overall || 0))
    : []

  return (
    <div className={styles.panel}>
      <RecommendedBlock recommendations={recommendations} onToggle={onToggle} />
      {myTeamId && (
        <>
          <div className={styles.header}>MY TEAM</div>
          <StrategyBlock needs={needs} runs={runs} nextPick={nextPick} />
          <ul className={`${styles.list} ${styles.myList}`}>
            {myPicks.map(pick => (
              <PickItem key={pick.id} pick={pick} onToggle={onToggle} onRemove={onRemove} syncActive={syncActive} />
            ))}
            {myPicks.length === 0 && (
              <li className={styles.empty}>No picks yet</li>
            )}
          </ul>
        </>
      )}
      <div className={styles.header}>DRAFTED</div>
      <ul className={styles.list}>
        {draftedList.map(pick => (
          <PickItem key={pick.id} pick={pick} onToggle={onToggle} onRemove={onRemove} syncActive={syncActive} />
        ))}
      </ul>
    </div>
  )
}
