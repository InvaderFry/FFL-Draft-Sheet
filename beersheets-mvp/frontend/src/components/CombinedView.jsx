import PlayerTable from './PlayerTable'
import { POS_COLORS } from '../utils/posColors'
import styles from './CombinedView.module.css'

// Each entry is one grid column; 'split' columns stack their positions 50/50.
const COMBINED_COLUMNS = [
  { type: 'split', positions: ['QB', 'TE'] },
  { type: 'full',  positions: ['WR'] },
  { type: 'full',  positions: ['RB'] },
]

const tableStyle = {
  maxHeight: 'none',
  height: '100%',
  overflow: 'auto',
  flex: 1,
}

export default function CombinedView({ positions, nTeams, isDrafted, onToggle, auctionMode }) {
  return (
    <div className={styles.grid}>
      {COMBINED_COLUMNS.map(col => (
        <div
          key={col.positions[0]}
          className={col.type === 'split' ? styles.splitCol : styles.fullCol}
        >
          {col.positions.map(pos => (
            <div key={pos} className={styles.section}>
              <div className={styles.posHeader} style={{ color: POS_COLORS[pos] }}>{pos}</div>
              <PlayerTable
                players={positions[pos] || []}
                nTeams={nTeams}
                isDrafted={isDrafted}
                onToggle={onToggle}
                auctionMode={auctionMode}
                wrapStyle={tableStyle}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
