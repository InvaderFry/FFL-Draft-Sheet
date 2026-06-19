import { useState } from 'react'
import type { ReactNode } from 'react'
import { TIER_METHODS } from '../utils/tierAccess'
import styles from './Legend.module.css'

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  TIER_METHODS.map((m): [string, string] => [m.id, m.label]),
)
const methodLabel = (id: string): string => METHOD_LABEL[id] || id

/** A column-guide row whose abbreviation is plain text. */
interface ColumnEntry {
  abbrev: string
  full: string
  desc: string
}

/** A guide row in the rendered list; abbrev may be rich content, with an
 * optional accent color. */
interface LegendEntry {
  abbrev: ReactNode
  full: string
  desc: string
  color?: string
}

const COLUMN_ENTRIES: ColumnEntry[] = [
  { abbrev: 'TM/BW',  full: 'Team / Bye Week',        desc: 'NFL team abbreviation and the team\'s bye week number' },
  { abbrev: 'ECR',    full: 'Expert Consensus Rank',   desc: 'Draft position shown as Round|Pick (e.g. 3|07). Blue = ADP >1 round earlier than experts (crowd reach); Orange = ADP >1 round later (hidden value)' },
  { abbrev: 'F',      full: 'Floor',                   desc: 'Projected points minus one standard deviation, above the positional baseline (pessimistic outcome)' },
  { abbrev: 'VAL',    full: 'Value',                   desc: 'Mean projected points above the positional replacement baseline — the core VBD metric' },
  { abbrev: 'C',      full: 'Ceiling',                 desc: 'Projected points plus one standard deviation, above the positional baseline (optimistic outcome)' },
  { abbrev: 'PS%',    full: 'Positional Scarcity',     desc: '% of total positive positional value remaining after this player is drafted. Lower % = more urgent pick' },
]

const AUCTION_ENTRY: ColumnEntry = { abbrev: '$', full: 'Auction Price', desc: 'Estimated dollar value in auction mode, derived from each player\'s share of total VBD value' }

// Abbreviations hidden from the table (and thus the guide) in thin mode.
const THIN_HIDDEN = new Set(['TM/BW', 'F'])

interface TierEntriesArgs {
  shadeBy: string
  linesBy: string
  manualEdit: boolean
}

// Tier-display entries reflect the active Shade / Lines selection so the guide
// explains exactly what's on screen.
function tierEntries({ shadeBy, linesBy, manualEdit }: TierEntriesArgs): LegendEntry[] {
  const entries: LegendEntry[] = [{
    abbrev: 'Tiers',
    full: 'Tier Shading',
    desc: `Alternating light/dark row shading groups players into tiers using the ${methodLabel(shadeBy)} method. Change it with the "Shade" selector.`,
  }]
  if (linesBy && linesBy !== 'none') {
    entries.push({
      abbrev: (
        <span aria-hidden="true">
          {[1, 2, 3, 4].map(n => (
            <span key={n} style={{ color: `var(--c-tier-line-${n})` }}>▬</span>
          ))}
        </span>
      ),
      full: 'Tier Line',
      desc: `Colored rule marking ${methodLabel(linesBy)} tier boundaries — set with the "Lines" selector — so you can compare two tiering methods at once: shading is one method, the line is another. The line color cycles through 4 colors per tier so neighboring tiers are easy to tell apart.`,
    })
  }
  if (manualEdit) {
    entries.push({
      abbrev: '┃ ╌',
      color: 'var(--c-tier-line)',
      full: 'Tier Break',
      desc: 'In Manual mode, click the handle before a name to start a new tier (┃) or remove a break (╌) at that row. Manual tiers seed from the other selected method and are saved per league.',
    })
  }
  return entries
}

interface LegendProps {
  auctionMode: boolean
  thinMode?: boolean
  shadeBy?: string
  linesBy?: string
  manualEdit?: boolean
}

export default function Legend({ auctionMode, thinMode = false, shadeBy = 'jenks', linesBy = 'none', manualEdit = false }: LegendProps) {
  const [open, setOpen] = useState(false)

  const columnEntries = thinMode
    ? COLUMN_ENTRIES.filter(e => !THIN_HIDDEN.has(e.abbrev))
    : COLUMN_ENTRIES
  const entries: LegendEntry[] = [
    ...columnEntries,
    ...(auctionMode ? [AUCTION_ENTRY] : []),
    ...tierEntries({ shadeBy, linesBy, manualEdit }),
  ]

  return (
    <div className={styles.legend}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="legend-grid"
      >
        Column Guide <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div id="legend-grid" className={styles.grid}>
          {entries.map(({ abbrev, full, desc, color }) => (
            <div key={full} className={styles.entry}>
              <span className={styles.abbrev} style={color ? { color } : undefined}>{abbrev}</span>
              <span className={styles.text}>
                <span className={styles.full}>{full}</span>
                {' — '}
                {desc}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
