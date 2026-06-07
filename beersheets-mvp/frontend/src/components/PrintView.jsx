import { memo } from 'react'
import { ecrColor } from '../utils/ecrColor'
import { fmtVal } from '../utils/formatters'
import { valBgStyle, psPctBgStyle } from '../utils/valGradient'
import '../styles/print.css'

const POSITION_LABELS = {
  QB: 'QUARTERBACK',
  RB: 'RUNNING BACK',
  WR: 'WIDE RECEIVER',
  TE: 'TIGHT END',
}

const POSITION_LIMITS = {
  QB: 30,
  RB: 66,
  WR: 66,
  TE: 24,
}

const DST_LIMIT = 14

function fmtNumber(value) {
  if (value == null || isNaN(value)) return '0'
  return Number(value).toFixed(2).replace(/\.?0+$/, '')
}

function pprLabel(scoring) {
  const ppr = Number(scoring?.rec ?? 0.5)
  if (isNaN(ppr)) return '0.5 PPR'
  if (ppr === 0) return 'Standard'
  if (ppr === 1) return 'PPR'
  return `${fmtNumber(ppr)} PPR`
}

function slotValue(config, pos, fallback) {
  return Number(config?.[pos] ?? fallback)
}

function buildRosterLine(config) {
  const nTeams = Number(config?.n_teams ?? 12)
  const slots = [
    ['QB', slotValue(config, 'QB', 1)],
    ['RB', slotValue(config, 'RB', 2)],
    ['WR', slotValue(config, 'WR', 3)],
    ['TE', slotValue(config, 'TE', 1)],
    ['DST', slotValue(config, 'DST', 1)],
    ['K', slotValue(config, 'K', 0)],
  ]

  const starters = slots
    .filter(([, count]) => count > 0)
    .map(([pos, count]) => `${count}${pos}(${count * nTeams})`)

  const flexSlots = Number(config?.flex_slots ?? 0)
  if (flexSlots > 0) starters.push(`${flexSlots}[FLEX]`)

  return starters.join(' / ')
}

function buildScoringLine(scoring = {}) {
  const passTd = fmtNumber(scoring.pass_td ?? 4)
  const passYd = fmtNumber(scoring.pass_yds ?? 0.04)
  const int = fmtNumber(scoring.interception ?? -2)
  const rushTd = fmtNumber(scoring.rush_td ?? 6)
  const rushYd = fmtNumber(scoring.rush_yds ?? 0.1)
  const recTd = fmtNumber(scoring.rec_td ?? 6)
  const recYd = fmtNumber(scoring.rec_yds ?? 0.1)
  const rec = fmtNumber(scoring.rec ?? 0.5)
  const fumbleLost = fmtNumber(scoring.fumble_lost ?? -2)
  const tePremium = Number(scoring.te_premium ?? 0)
  const tePremiumLabel = tePremium !== 0 ? `, ${fmtNumber(tePremium)} TE premium` : ''

  return `Passing: ${passTd}pt TD, ${passYd}/yd, ${int} Int | Rushing: ${rushTd}pt TD, ${rushYd}/yd | Receiving: ${recTd}pt TD, ${recYd}/yd, ${rec} PPR${tePremiumLabel} | Turnovers: ${fumbleLost} Fum Lost`
}

function printEcrStyle(color) {
  if (color === 'orange') return { color: '#c2410c' }
  if (color === 'blue') return { color: '#1d4ed8' }
  return {}
}

function printValStyle(value, minValue, maxValue) {
  if (value == null || isNaN(value) || minValue === maxValue) return {}
  const t = Math.max(0, Math.min((value - minValue) / (maxValue - minValue), 1))
  if (t >= 0.67) return valBgStyle(value, minValue, maxValue, 'print', 0.40)
  if (t <= 0.33) return valBgStyle(value, minValue, maxValue, 'print', 0.25)
  return {}
}

function printPsStyle(psPct) {
  if (psPct == null || isNaN(psPct)) return {}
  const t = Math.max(0, Math.min(psPct, 100)) / 100
  if (t >= 0.67) return psPctBgStyle(psPct, 'print', 0.40)
  if (t <= 0.33) return psPctBgStyle(psPct, 'print', 0.25)
  return {}
}

function playerKey(player, idx) {
  return player.sleeper_id || `${player.player_name}-${idx}`
}

function teamBye(player) {
  const team = player.team || '—'
  return player.bye_week ? `${team}/${player.bye_week}` : team
}

function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

function PositionTableBase({ pos, players, nTeams, isDrafted, minVal, maxVal, auctionMode }) {
  const visible = players.slice(0, POSITION_LIMITS[pos] ?? players.length)

  return (
    <section className={`print-pos-block print-pos-${pos.toLowerCase()}`}>
      <div className="print-pos-header">{POSITION_LABELS[pos] ?? pos}</div>
      <table className="print-player-table">
        <thead>
          <tr>
            <th className="col-name">NAME</th>
            <th className="col-tmbw">TM/BW</th>
            <th className="col-ecr">ECR</th>
            <th className="col-num">F</th>
            <th className="col-num col-val">VAL</th>
            <th className="col-num">C</th>
            <th className="col-num">PS</th>
            {auctionMode && <th className="col-num col-auction">$</th>}
          </tr>
        </thead>
        <tbody>
          {visible.map((player, idx) => {
            const drafted = isDrafted(player.sleeper_id || player.player_name)
            const tierClass = player.tier_is_even ? 'tier-even' : 'tier-odd'
            const previous = visible[idx - 1]
            const isTierStart = idx > 0 && player.tier != null && previous?.tier !== player.tier
            const ecr = ecrColor(player.adp_rank, player.ecr_rank, nTeams)

            return (
              <tr
                key={playerKey(player, idx)}
                className={classNames(tierClass, isTierStart && 'tier-start', drafted && 'drafted')}
              >
                <td className={`col-name ${drafted ? 'name-drafted' : ''}`}>
                  {player.player_name}
                </td>
                <td className="col-tmbw">{teamBye(player)}</td>
                <td className="col-ecr" style={printEcrStyle(ecr)}>{player.ecr_fmt || '—'}</td>
                <td className="col-num">{fmtVal(player.floor)}</td>
                <td className="col-num col-val" style={printValStyle(player.val, minVal, maxVal)}>{fmtVal(player.val)}</td>
                <td className="col-num">{fmtVal(player.ceil)}</td>
                <td className="col-num" style={printPsStyle(player.ps_pct)}>
                  {player.ps_pct != null ? `${Math.round(player.ps_pct)}%` : '—'}
                </td>
                {auctionMode && (
                  <td className="col-num col-auction">
                    {player.auction_price != null ? `$${player.auction_price}` : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

const PositionTable = memo(PositionTableBase)

export default function PrintView({ sheetData, config, isDrafted }) {
  if (!sheetData) return null

  const { positions = {}, metadata } = sheetData
  const nTeams = config?.n_teams || 12
  const scoring = config?.scoring ?? {}
  const auctionMode = !!config?.auction_mode
  const valValues = ['QB', 'RB', 'WR', 'TE'].flatMap(pos => positions[pos] || []).map(p => p.val ?? 0)
  const minVal = valValues.length > 0 ? Math.min(...valValues) : 0
  const maxVal = valValues.length > 0 ? Math.max(...valValues) : 0
  const dstPlayers = (positions.DST || [])
    .slice()
    .sort((a, b) => (b.val ?? 0) - (a.val ?? 0))
    .slice(0, DST_LIMIT)

  return (
    <div className="zsheet-print print-sheet" aria-hidden="true">
      <header className="print-heading">
        <div className="print-title-row">
          <h2>ZSheet — {nTeams} Team · {pprLabel(scoring)}</h2>
          <span className="print-title-roster">{buildRosterLine(config)}</span>
          <time>{new Date().toLocaleDateString()}</time>
        </div>
        <div className="print-subtitle">
          {buildScoringLine(scoring)}
        </div>
      </header>

      <div className="print-main-grid">
        <div className="print-left-stack">
          <PositionTable
            pos="QB"
            players={positions.QB || []}
            nTeams={nTeams}
            isDrafted={isDrafted}
            minVal={minVal}
            maxVal={maxVal}
            auctionMode={auctionMode}
          />
          <PositionTable
            pos="TE"
            players={positions.TE || []}
            nTeams={nTeams}
            isDrafted={isDrafted}
            minVal={minVal}
            maxVal={maxVal}
            auctionMode={auctionMode}
          />
        </div>
        <PositionTable
          pos="RB"
          players={positions.RB || []}
          nTeams={nTeams}
          isDrafted={isDrafted}
          minVal={minVal}
          maxVal={maxVal}
          auctionMode={auctionMode}
        />
        <PositionTable
          pos="WR"
          players={positions.WR || []}
          nTeams={nTeams}
          isDrafted={isDrafted}
          minVal={minVal}
          maxVal={maxVal}
          auctionMode={auctionMode}
        />
      </div>

      <footer className="print-bottom">
        <section className="print-dst">
          <h2>DEFENSE / SPECIAL TEAMS</h2>
          <ol>
            {dstPlayers.map((player, idx) => {
              const drafted = isDrafted(player.sleeper_id || player.player_name)
              return (
                <li key={playerKey(player, idx)} className={drafted ? 'drafted' : ''}>
                  <span className={drafted ? 'name-drafted' : ''}>{player.player_name}</span>
                  {auctionMode && (
                    <span className="print-dst-price">
                      {player.auction_price != null ? `$${player.auction_price}` : '—'}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>

        <section className="print-notes">
          <p><strong>ECR:</strong> Player rank from FantasyPros Expert Consensus Ranking formatted as Rnd|Pick, so 1|3 means the 3rd pick of the 1st round. Orange means ADP is a round or more behind consensus: value, likely available later than expected. Blue means ADP is a round or more ahead: tends to go earlier than experts suggest.</p>
          <p><strong>F, VAL, C:</strong> Player projected weekly value above a positional baseline replacement player. Rows are shaded by value tiers. A thicker top border marks a new tier. F and C are floor and ceiling based on projection variance.</p>
          <p><strong>PS:</strong> Positional scarcity, the percentage of total positive value remaining in the position after this player is selected.</p>
          {auctionMode && <p><strong>$:</strong> Estimated auction price derived from each player&apos;s share of total positive draft value.</p>}
          {metadata?.baselines && (
            <p className="print-baselines">
              <strong>Baselines:</strong> {Object.entries(metadata.baselines).map(([pos, value]) => `${pos} ${fmtVal(value)}`).join(' · ')}
            </p>
          )}
        </section>
      </footer>
    </div>
  )
}
