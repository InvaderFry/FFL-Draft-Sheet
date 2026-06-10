import styles from './DraftedPanel.module.css'

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

export default function DraftedPanel({ draftedList, onToggle, onRemove = () => {}, myTeamId = null, syncActive = false }) {
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
