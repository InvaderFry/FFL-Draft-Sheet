/**
 * U13 — PlayerTable
 *
 * Renders one position's player list as a table. Clicking a row toggles the
 * drafted state. Tier shading alternates white/gray per tier band.
 * ECR column coloring applied via ecrColor utility.
 */

import { ecrColor, ecrColorStyle } from '../utils/ecrColor'
import styles from './PlayerTable.module.css'

const COLUMNS = [
  { key: 'player_name', label: 'NAME',   align: 'left',   width: '130px' },
  { key: 'tm_bw',       label: 'TM/BW',  align: 'left',   width: '64px'  },
  { key: 'ecr_fmt',     label: 'ECR',    align: 'center', width: '52px'  },
  { key: 'floor',       label: 'F',      align: 'right',  width: '44px'  },
  { key: 'val',         label: 'VAL',    align: 'right',  width: '44px'  },
  { key: 'ceil',        label: 'C',      align: 'right',  width: '44px'  },
  { key: 'ps_pct',      label: 'PS%',    align: 'right',  width: '44px'  },
]

export default function PlayerTable({ players, nTeams, isDrafted, onToggle, auctionMode, wrapStyle }) {
  const cols = auctionMode
    ? [...COLUMNS, { key: 'auction_price', label: '$', align: 'right', width: '42px' }]
    : COLUMNS

  const visible = players.filter(p => !isDrafted(p.sleeper_id || p.player_name))

  return (
    <div className={styles.tableWrap} style={wrapStyle}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.selCol}></th>
            {cols.map(col => (
              <th key={col.key} style={{ textAlign: col.align, width: col.width }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((player) => {
            const tierClass = player.tier_is_even ? styles.tierEven : styles.tierOdd
            const ecr = ecrColor(player.adp_rank, player.ecr_rank, nTeams)
            const ecrStyle = { color: ecrColorStyle(ecr) }

            return (
              <tr
                key={player.sleeper_id || player.player_name}
                className={tierClass}
                onClick={() => onToggle(player.sleeper_id || player.player_name, player.player_name, player.pos)}
                title="Click to mark as drafted"
              >
                <td className={styles.selCol}></td>
                <td className={styles.nameCell}>
                  {player.player_name}
                </td>
                <td className={styles.teamCell}>
                  <span className={styles.team}>{player.team}</span>
                  {player.bye_week && <span className={styles.bye}>{player.bye_week}</span>}
                </td>
                <td className={styles.ecrCell} style={ecrStyle}>
                  {player.ecr_fmt}
                </td>
                <td className={styles.numCell}>{fmtVal(player.floor)}</td>
                <td className={`${styles.numCell} ${styles.valCell}`}>{fmtVal(player.val)}</td>
                <td className={styles.numCell}>{fmtVal(player.ceil)}</td>
                <td className={styles.numCell}>{player.ps_pct != null ? `${player.ps_pct}%` : '—'}</td>
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

function fmtVal(v) {
  if (v == null || isNaN(v)) return '—'
  return v >= 0 ? v.toFixed(1) : `(${Math.abs(v).toFixed(1)})`
}
