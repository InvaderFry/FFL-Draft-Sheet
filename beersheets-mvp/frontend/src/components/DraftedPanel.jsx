import styles from './DraftedPanel.module.css'

export default function DraftedPanel({ draftedList, onToggle }) {
  if (draftedList.length === 0) return null

  return (
    <div className={styles.panel}>
      <div className={styles.header}>DRAFTED</div>
      <ul className={styles.list}>
        {draftedList.map(({ id, name, pos }) => (
          <li
            key={id}
            className={styles.item}
            onClick={() => onToggle(id, name, pos)}
            title="Click to undo draft"
          >
            {name} <span className={styles.pos}>{pos}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
