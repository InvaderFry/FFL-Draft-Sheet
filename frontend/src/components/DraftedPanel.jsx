import styles from './DraftedPanel.module.css'

function PickItem({ pick, onToggle }) {
  const { id, name, pos, source, teamName } = pick
  const synced = source === 'espn'
  return (
    <li
      className={`${styles.item} ${synced ? styles.itemSynced : ''}`}
      onClick={synced ? undefined : () => onToggle(id, name, pos)}
      title={synced ? 'Synced from ESPN — undo in your draft room' : 'Click to undo draft'}
    >
      <div className={styles.itemName}>
        {name} <span className={styles.pos}>{pos}</span>
      </div>
      {synced && teamName && <div className={styles.team}>{teamName}</div>}
    </li>
  )
}

export default function DraftedPanel({ draftedList, onToggle, myTeamId = null }) {
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
              <PickItem key={pick.id} pick={pick} onToggle={onToggle} />
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
          <PickItem key={pick.id} pick={pick} onToggle={onToggle} />
        ))}
      </ul>
    </div>
  )
}
