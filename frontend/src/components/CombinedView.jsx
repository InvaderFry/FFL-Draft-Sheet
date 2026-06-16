import PlayerTable from './PlayerTable'
import { useTheme } from '../context/ThemeContext'
import styles from './CombinedView.module.css'

// Each entry is one grid column; 'split' columns stack their positions 50/50.
const COMBINED_COLUMNS = [
  { type: 'split', positions: ['QB', 'TE'] },
  { type: 'full',  positions: ['RB'] },
  { type: 'full',  positions: ['WR'] },
]

const tableStyle = {
  maxHeight: 'none',
  height: '100%',
  overflow: 'auto',
  flex: 1,
}

export default function CombinedView({
  positions,
  nTeams,
  isDrafted,
  onToggle,
  auctionMode,
  minVal = 0,
  maxVal = 0,
  strategy = null,
  search = '',
  watchedOnly = false,
  isWatched = () => false,
  toggleWatch = () => {},
  shadeBy = 'jenks',
  linesBy = 'none',
  manualTiers = null,
}) {
  const { posColors } = useTheme()
  return (
    <div className={styles.grid}>
      {COMBINED_COLUMNS.map(col => (
        <div
          key={col.positions[0]}
          className={col.type === 'split' ? styles.splitCol : styles.fullCol}
        >
          {col.positions.map(pos => (
            <div key={pos} className={styles.section}>
              <div className={styles.posHeader} style={{ color: posColors[pos] }}>{pos}</div>
              <PlayerTable
                players={positions[pos] || []}
                nTeams={nTeams}
                isDrafted={isDrafted}
                onToggle={onToggle}
                auctionMode={auctionMode}
                minVal={minVal}
                maxVal={maxVal}
                strategy={strategy}
                search={search}
                watchedOnly={watchedOnly}
                isWatched={isWatched}
                toggleWatch={toggleWatch}
                shadeBy={shadeBy}
                linesBy={linesBy}
                manualTiers={manualTiers}
                wrapStyle={tableStyle}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
