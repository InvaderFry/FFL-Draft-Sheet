import { memo, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { ecrColor } from '../utils/ecrColor'
import type { EcrColor } from '../utils/ecrColor'
import { fmtVal, fmtInt, fmtPct } from '../utils/formatters'
import { valBgStyle, psPctBgStyle, valGradientPosition, valRangeFromPositions } from '../utils/valGradient'
import { tierFor, tierNumberMethod, TIER_METHODS } from '../utils/tierAccess'
import type { PlayerRow, SheetResponse } from '../types/api'
import type { LeagueConfig, ManualTiers, Positions, ScoringConfig } from '../types/domain'
import '../styles/print.css'

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  TIER_METHODS.map((m): [string, string] => [m.id, m.label]),
)
const methodLabel = (id: string): string => METHOD_LABEL[id] || id

const POSITION_LABELS: Record<string, string> = {
  QB: 'QUARTERBACK',
  RB: 'RUNNING BACK',
  WR: 'WIDE RECEIVER',
  TE: 'TIGHT END',
}

const POSITION_LIMITS: Record<string, number> = {
  QB: 30,
  RB: 66,
  WR: 66,
  TE: 24,
}

const DST_LIMIT = 12
const EMPTY_POSITIONS: Positions = {}

function fmtNumber(value: number | string | null | undefined): string {
  if (value == null || isNaN(Number(value))) return '0'
  return Number(value).toFixed(2).replace(/\.?0+$/, '')
}

function pprLabel(scoring: ScoringConfig): string {
  const ppr = Number(scoring?.rec ?? 0.5)
  if (isNaN(ppr)) return '0.5 PPR'
  if (ppr === 0) return 'Standard'
  if (ppr === 1) return 'PPR'
  return `${fmtNumber(ppr)} PPR`
}

function slotValue(config: LeagueConfig | null | undefined, pos: string, fallback: number): number {
  return Number(config?.[pos] ?? fallback)
}

function buildRosterLine(config: LeagueConfig | null | undefined): string {
  const nTeams = Number(config?.n_teams ?? 12)
  const slots: [string, number][] = [
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

function buildScoringLine(scoring: ScoringConfig = {}): string {
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

function printEcrStyle(color: EcrColor): CSSProperties {
  if (color === 'orange') return { color: '#c2410c' }
  if (color === 'blue') return { color: '#1d4ed8' }
  return {}
}

function printValStyle(value: number | null | undefined, minValue: number, maxValue: number): CSSProperties {
  // Continuous full-range gradient on the shared (global) val range, matching
  // the web view so every position's VAL column is shaded — not just the extremes.
  return valBgStyle(value, minValue, maxValue, 'print', 0.30)
}

function printPsStyle(psPct: number | null | undefined): CSSProperties {
  const t = valGradientPosition(psPct, 0, 100)
  if (t == null) return {}
  if (t >= 0.67) return psPctBgStyle(psPct, 'print', 0.40)
  if (t <= 0.33) return psPctBgStyle(psPct, 'print', 0.25)
  return {}
}

function playerKey(player: PlayerRow, idx: number): string {
  return player.sleeper_id || `${player.player_name}-${idx}`
}

function teamBye(player: PlayerRow): string {
  const team = player.team || '—'
  return player.bye_week ? `${team}/${player.bye_week}` : team
}

function classNames(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

interface PositionTableProps {
  pos: string
  players: PlayerRow[]
  nTeams: number
  isDrafted: (id: string) => boolean
  minVal: number
  maxVal: number
  auctionMode: boolean
  shadeBy: string
  linesBy: string
  manualTiers: ManualTiers | null
}

function PositionTableBase({ pos, players, nTeams, isDrafted, minVal, maxVal, auctionMode, shadeBy, linesBy, manualTiers }: PositionTableProps) {
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
            const previous = visible[idx - 1]
            const shadeTier = tierFor(player, shadeBy, manualTiers)
            const tierClass = shadeTier != null && shadeTier % 2 === 0 ? 'tier-even' : 'tier-odd'
            const isTierStart = idx > 0 && shadeTier != null && tierFor(previous, shadeBy, manualTiers) !== shadeTier
            const lineTier = tierFor(player, linesBy, manualTiers)
            const isLineStart = idx > 0 && lineTier != null && tierFor(previous, linesBy, manualTiers) !== lineTier
            // Far-left tier number per tier band (Lines method, or Shade when none).
            const numMethod = tierNumberMethod(shadeBy, linesBy)
            const numTier = tierFor(player, numMethod, manualTiers)
            const isNumberStart = numTier != null &&
              (idx === 0 || tierFor(previous, numMethod, manualTiers) !== numTier)
            const ecr = ecrColor(player.adp_rank, player.ecr_rank, nTeams)

            return (
              <tr
                key={playerKey(player, idx)}
                className={classNames(tierClass, isTierStart && 'tier-start', isLineStart && 'tier-line-start', drafted && 'drafted')}
              >
                <td className={`col-name ${drafted ? 'name-drafted' : ''}`}>
                  {isNumberStart && <span className="tier-num" aria-hidden="true">{numTier}</span>}
                  <span className="print-name-inner">{player.player_name}</span>
                </td>
                <td className="col-tmbw">{teamBye(player)}</td>
                <td className="col-ecr" style={printEcrStyle(ecr)}>{player.ecr_fmt || '—'}</td>
                <td className="col-num">{fmtInt(player.floor)}</td>
                <td className="col-num col-val" style={printValStyle(player.val, minVal, maxVal)}>{fmtVal(player.val)}</td>
                <td className="col-num">{fmtInt(player.ceil)}</td>
                <td className="col-num" style={printPsStyle(player.ps_pct)}>{fmtPct(player.ps_pct)}</td>
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

interface PrintViewProps {
  sheetData: SheetResponse | null | undefined
  config: LeagueConfig | null | undefined
  isDrafted: (id: string) => boolean
  shadeBy?: string
  linesBy?: string
  manualTiers?: ManualTiers | null
}

export default function PrintView({ sheetData, config, isDrafted, shadeBy = 'jenks', linesBy = 'none', manualTiers = null }: PrintViewProps) {
  const positions = sheetData?.positions ?? EMPTY_POSITIONS
  const metadata = sheetData?.metadata
  const { minVal, maxVal } = useMemo(() => {
    // Scale the gradient to the players actually printed (top N per position),
    // not the full dataset — so the lowest listed VAL maps to the bottom of the
    // range and the full blue→orange spectrum is used across the printed rows.
    const visiblePositions: Positions = {}
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      visiblePositions[pos] = (positions[pos] || []).slice(0, POSITION_LIMITS[pos])
    }
    return valRangeFromPositions(visiblePositions)
  }, [positions])

  if (!sheetData) return null

  const nTeams = Number(config?.n_teams) || 12
  const scoring: ScoringConfig = config?.scoring ?? {}
  const auctionMode = Boolean(config?.auction_mode)
  const dstPlayers = (positions.DST || [])
    .slice()
    .sort((a, b) => (b.val ?? 0) - (a.val ?? 0))
    .slice(0, DST_LIMIT)

  return (
    <div className="zsheet-print print-sheet" aria-hidden="true">
      <header className="print-heading">
        <div className="print-title-row">
          <div className="print-brand">
            <span className="print-wordmark">ZSheet</span>
            <span className="print-format">{nTeams}-Team · {pprLabel(scoring)}</span>
          </div>
          <time>{new Date().toLocaleDateString()}</time>
        </div>
        <div className="print-meta-strip">
          <span className="print-meta-label">Roster</span>
          <span className="print-meta-value">{buildRosterLine(config)}</span>
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
            shadeBy={shadeBy}
            linesBy={linesBy}
            manualTiers={manualTiers}
          />
          <PositionTable
            pos="TE"
            players={positions.TE || []}
            nTeams={nTeams}
            isDrafted={isDrafted}
            minVal={minVal}
            maxVal={maxVal}
            auctionMode={auctionMode}
            shadeBy={shadeBy}
            linesBy={linesBy}
            manualTiers={manualTiers}
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
          shadeBy={shadeBy}
          linesBy={linesBy}
          manualTiers={manualTiers}
        />
        <PositionTable
          pos="WR"
          players={positions.WR || []}
          nTeams={nTeams}
          isDrafted={isDrafted}
          minVal={minVal}
          maxVal={maxVal}
          auctionMode={auctionMode}
          shadeBy={shadeBy}
          linesBy={linesBy}
          manualTiers={manualTiers}
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
          <p className="print-scoring"><strong>Scoring:</strong> {buildScoringLine(scoring)}</p>
          <p><strong>ECR:</strong> Player rank from FantasyPros Expert Consensus Ranking formatted as Rnd|Pick, so 1|3 means the 3rd pick of the 1st round. Orange means ADP is a round or more behind consensus: value, likely available later than expected. Blue means ADP is a round or more ahead: tends to go earlier than experts suggest.</p>
          <p><strong>F, VAL, C:</strong> Player projected weekly value above a positional baseline replacement player. Rows are shaded into tiers by the {methodLabel(shadeBy)} method; a thicker top border marks each new tier.{linesBy !== 'none' && ` A second, darker border marks ${methodLabel(linesBy)} tier boundaries, so two tiering methods can be compared at a glance.`} F and C are floor and ceiling based on projection variance.</p>
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
