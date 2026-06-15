import { STARTER_POS } from '../utils/draftStrategy'
import styles from './DraftedPanel.module.css'

// Compact roster-needs + run-alert block shown under MY TEAM during a live
// draft. Renders nothing useful until there's strategy data to show.
function StrategyBlock({ needs, runs, nextPick }) {
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

function PickItem({ pick, onToggle, onRemove, syncActive }) {
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

export default function DraftedPanel({
  draftedList, onToggle, onRemove = () => {}, myTeamId = null, syncActive = false,
  needs = null, runs = null, nextPick = null,
}) {
  const myPicks = myTeamId
    ? draftedList
        .filter(p => p.teamId === myTeamId)
        .sort((a, b) => (a.overall || 0) - (b.overall || 0))
    : []

  return (
    <div className={styles.panel}>
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
