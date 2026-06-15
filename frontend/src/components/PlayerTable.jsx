/**
 * U13 — PlayerTable
 *
 * Renders one position's player list as a table. Clicking a row toggles the
 * drafted state. Tier shading alternates white/gray per tier band.
 * ECR column coloring applied via ecrColor utility.
 */

import { ecrColor, ecrColorStyle } from '../utils/ecrColor'
import { fmtVal } from '../utils/formatters'
import { valBgStyle, psPctBgStyle } from '../utils/valGradient'
import { survivalStatus } from '../utils/draftStrategy'
import { useTheme } from '../context/ThemeContext'
import styles from './PlayerTable.module.css'

// Tooltip + dot class for the "survives to your next pick?" marker. Both
// 'gone' (already past ADP — a falling player still on the board) and 'risky'
// (likely drafted before your next pick) share the urgent amber dot.
function survivalMarker(adpRank, currentPick, nextPick) {
  const status = survivalStatus(adpRank, currentPick, nextPick)
  if (status === 'gone') {
    return { cls: styles.survRisky, title: `ADP ${adpRank} · already past ADP — likely gone any pick now` }
  }
  if (status === 'risky') {
    return { cls: styles.survRisky, title: `ADP ${adpRank} · likely gone before your pick ${nextPick}` }
  }
  if (status === 'safe') {
    return { cls: styles.survSafe, title: `ADP ${adpRank} · should reach your pick ${nextPick}` }
  }
  return null
}

const COLUMNS = [
  { key: 'player_name', label: 'NAME',   align: 'left',   width: '130px' },
  { key: 'tm_bw',       label: 'TM/BW',  align: 'left',   width: '64px'  },
  { key: 'ecr_fmt',     label: 'ECR',    align: 'center', width: '52px'  },
  { key: 'floor',       label: 'F',      align: 'right',  width: '44px'  },
  { key: 'val',         label: 'VAL',    align: 'right',  width: '44px'  },
  { key: 'ceil',        label: 'C',      align: 'right',  width: '44px'  },
  { key: 'ps_pct',      label: 'PS%',    align: 'right',  width: '44px'  },
]

export default function PlayerTable({
  players,
  nTeams,
  isDrafted,
  onToggle,
  auctionMode,
  wrapStyle,
  minVal = 0,
  maxVal = 0,
  strategy = null,
  search = '',
  watchedOnly = false,
  isWatched = () => false,
  toggleWatch = () => {},
}) {
  const { theme } = useTheme()
  const cols = auctionMode
    ? [...COLUMNS, { key: 'auction_price', label: '$', align: 'right', width: '42px' }]
    : COLUMNS

  const searchTerm = search.trim().toLowerCase()
  const visible = players.filter(p => {
    const id = p.sleeper_id || p.player_name
    if (isDrafted(id)) return false
    if (watchedOnly && !isWatched(id)) return false
    if (searchTerm && !p.player_name.toLowerCase().includes(searchTerm)) return false
    return true
  })

  return (
    <div className={styles.tableWrap} style={wrapStyle}>
      <table className={styles.table}>
        <thead>
          <tr>
            {cols.map(col => (
              <th key={col.key} style={{ textAlign: col.align, width: col.width }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((player, idx) => {
            const tierClass = player.tier_is_even ? styles.tierEven : styles.tierOdd
            const previous = visible[idx - 1]
            const isTierStart = idx > 0 && player.tier != null && previous?.tier !== player.tier
            const ecr = ecrColor(player.adp_rank, player.ecr_rank, nTeams)
            const ecrStyle = { color: ecrColorStyle(ecr) }
            const valStyle = valBgStyle(player.val, minVal, maxVal, theme)
            const psStyle  = psPctBgStyle(player.ps_pct, theme)
            const id = player.sleeper_id || player.player_name
            const watched = isWatched(id)
            const surv = strategy
              ? survivalMarker(player.adp_rank, strategy.currentPick, strategy.nextPick)
              : null

            return (
              <tr
                key={player.sleeper_id || `${player.player_name}-${idx}`}
                className={`${tierClass} ${isTierStart ? styles.tierStart : ''}`}
                onClick={() => onToggle(id, player.player_name, player.pos)}
                title="Click to mark as drafted"
              >
                <td className={styles.nameCell}>
                  <button
                    type="button"
                    className={`${styles.starBtn} ${watched ? styles.watched : ''}`}
                    aria-label={`${watched ? 'Remove' : 'Add'} ${player.player_name} ${watched ? 'from' : 'to'} watchlist`}
                    title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleWatch(id)
                    }}
                  >
                    {watched ? '★' : '☆'}
                  </button>
                  {surv && <span className={`${styles.survDot} ${surv.cls}`} title={surv.title} />}
                  <span className={styles.playerName}>{player.player_name}</span>
                </td>
                <td className={styles.teamCell}>
                  <span className={styles.team}>{player.team}</span>
                  {player.bye_week && <span className={styles.bye}>{player.bye_week}</span>}
                </td>
                <td className={styles.ecrCell} style={ecrStyle}>
                  {player.ecr_fmt}
                </td>
                <td className={styles.numCell}>{fmtVal(player.floor)}</td>
                <td className={`${styles.numCell} ${styles.valCell}`} style={valStyle}>{fmtVal(player.val)}</td>
                <td className={styles.numCell}>{fmtVal(player.ceil)}</td>
                <td className={styles.numCell} style={psStyle}>{player.ps_pct != null ? `${player.ps_pct}%` : '—'}</td>
                {auctionMode && (
                  <td className={`${styles.numCell} ${styles.auctionCell}`}>
                    {player.auction_price != null ? `$${player.auction_price}` : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
