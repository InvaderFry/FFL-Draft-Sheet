/**
 * U14 — PrintView
 *
 * Renders all positions in a compact multi-column layout (QB | RB | WR | TE | DST)
 * matching the classic BeerSheets one-page format.  Hidden in the normal view;
 * shown by @media print via print.css.
 *
 * The component is appended to the DOM at all times so window.print() captures it.
 * Drafted players are shown with strikethrough so the sheet can be shared mid-draft.
 */

import { ecrColor, ecrColorStyle } from '../utils/ecrColor'
import '../styles/print.css'

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST']

function fmtVal(v) {
  if (v == null || isNaN(v)) return '—'
  if (v < 0) return `(${Math.abs(v).toFixed(1)})`
  return v.toFixed(1)
}

export default function PrintView({ sheetData, config, isDrafted }) {
  if (!sheetData) return null

  const { positions, metadata } = sheetData
  const nTeams = config?.n_teams || 12
  const pprLabel = config?.scoring?.rec === 1 ? 'PPR' : config?.scoring?.rec === 0.5 ? '0.5 PPR' : 'Standard'

  return (
    <div className="print-only print-sheet">
      {/* Title row */}
      <div className="print-title">
        <strong>FFL Draft Sheet</strong> — {nTeams} Team · {pprLabel}
        {metadata?.baselines && (
          <span className="print-baselines">
            &nbsp;&nbsp;
            {Object.entries(metadata.baselines)
              .filter(([, v]) => v > 0)
              .map(([pos, pts]) => `${pos}(${pts.toFixed(0)})`)
              .join(' / ')}
          </span>
        )}
        <span className="print-date">{new Date().toLocaleDateString()}</span>
      </div>

      {/* ECR legend */}
      <div className="print-legend">
        ECR: round|pick &nbsp;·&nbsp;
        <span style={{ color: 'blue' }}>Blue</span> = ADP &gt;1 round earlier &nbsp;·&nbsp;
        <span style={{ color: 'darkorange' }}>Orange</span> = ADP &gt;1 round later &nbsp;·&nbsp;
        Shading = tiers (alternating)
      </div>

      {/* Position blocks */}
      <div className="print-columns">
        {POS_ORDER.map(pos => {
          const players = positions[pos] || []
          if (!players.length) return null
          return (
            <div key={pos} className="print-pos-block">
              <div className="print-pos-header">{pos}</div>
              <table className="print-table">
                <thead>
                  <tr>
                    <th className="col-name">NAME</th>
                    <th className="col-tmbw">TM/BW</th>
                    <th className="col-ecr">ECR</th>
                    <th className="col-num">F</th>
                    <th className="col-num">VAL</th>
                    <th className="col-num">C</th>
                    <th className="col-num">PS</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player, idx) => {
                    const drafted = isDrafted(player.sleeper_id || player.player_name)
                    const tierClass = player.tier_is_even ? 'tier-even' : 'tier-odd'
                    const ecr = ecrColor(player.adp_rank, player.ecr_rank, nTeams)
                    const ecrStyle = { color: ecrColorStyle(ecr) }

                    return (
                      <tr key={player.sleeper_id || idx}
                          className={`${tierClass} ${drafted ? 'drafted' : ''}`}>
                        <td className={`col-name ${drafted ? 'name-drafted' : ''}`}>
                          {player.player_name}
                        </td>
                        <td className="col-tmbw">
                          {player.team}{player.bye_week ? `/${player.bye_week}` : ''}
                        </td>
                        <td className="col-ecr" style={ecrStyle}>{player.ecr_fmt}</td>
                        <td className="col-num">{fmtVal(player.floor)}</td>
                        <td className="col-num col-val">{fmtVal(player.val)}</td>
                        <td className="col-num">{fmtVal(player.ceil)}</td>
                        <td className="col-num">
                          {player.ps_pct != null ? `${Math.round(player.ps_pct)}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="print-footer">
        FFL Draft Sheet · Free VBD Cheat Sheet · github.com/InvaderFry/FFL-Draft-Sheet
      </div>
    </div>
  )
}
