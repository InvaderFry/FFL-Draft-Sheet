import PlayerTable from './PlayerTable'
import styles from './CombinedView.module.css'

const POS_COLORS = {
  QB: '#ef4444',
  TE: '#f59e0b',
  WR: '#60a5fa',
  RB: '#22c55e',
}

const tableStyle = {
  maxHeight: 'none',
  height: '100%',
  overflow: 'auto',
  flex: 1,
}

export default function CombinedView({ positions, nTeams, isDrafted, onToggle, auctionMode }) {
  return (
    <div className={styles.grid}>
      {/* Left column: QB stacked over TE */}
      <div className={styles.splitCol}>
        <div className={styles.section}>
          <div className={styles.posHeader} style={{ color: POS_COLORS.QB }}>QB</div>
          <PlayerTable
            players={positions.QB || []}
            nTeams={nTeams}
            isDrafted={isDrafted}
            onToggle={onToggle}
            auctionMode={auctionMode}
            wrapStyle={tableStyle}
          />
        </div>
        <div className={styles.section}>
          <div className={styles.posHeader} style={{ color: POS_COLORS.TE }}>TE</div>
          <PlayerTable
            players={positions.TE || []}
            nTeams={nTeams}
            isDrafted={isDrafted}
            onToggle={onToggle}
            auctionMode={auctionMode}
            wrapStyle={tableStyle}
          />
        </div>
      </div>

      {/* Middle column: WR */}
      <div className={styles.fullCol}>
        <div className={styles.posHeader} style={{ color: POS_COLORS.WR }}>WR</div>
        <PlayerTable
          players={positions.WR || []}
          nTeams={nTeams}
          isDrafted={isDrafted}
          onToggle={onToggle}
          auctionMode={auctionMode}
          wrapStyle={tableStyle}
        />
      </div>

      {/* Right column: RB */}
      <div className={styles.fullCol}>
        <div className={styles.posHeader} style={{ color: POS_COLORS.RB }}>RB</div>
        <PlayerTable
          players={positions.RB || []}
          nTeams={nTeams}
          isDrafted={isDrafted}
          onToggle={onToggle}
          auctionMode={auctionMode}
          wrapStyle={tableStyle}
        />
      </div>
    </div>
  )
}
