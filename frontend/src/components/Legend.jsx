import { useState } from 'react'
import styles from './Legend.module.css'

const BASE_ENTRIES = [
  { abbrev: 'TM/BW',  full: 'Team / Bye Week',        desc: 'NFL team abbreviation and the team\'s bye week number' },
  { abbrev: 'ECR',    full: 'Expert Consensus Rank',   desc: 'Draft position shown as Round|Pick (e.g. 3|07). Blue = ADP >1 round earlier than experts (crowd reach); Orange = ADP >1 round later (hidden value)' },
  { abbrev: 'F',      full: 'Floor',                   desc: 'Projected points minus one standard deviation, above the positional baseline (pessimistic outcome)' },
  { abbrev: 'VAL',    full: 'Value',                   desc: 'Mean projected points above the positional replacement baseline — the core VBD metric' },
  { abbrev: 'C',      full: 'Ceiling',                 desc: 'Projected points plus one standard deviation, above the positional baseline (optimistic outcome)' },
  { abbrev: 'PS%',    full: 'Positional Scarcity',     desc: '% of total positive positional value remaining after this player is drafted. Lower % = more urgent pick' },
  { abbrev: 'Tiers',  full: 'Tier Shading',            desc: 'Alternating light/dark row shading groups players of similar projected value using Jenks natural breaks' },
]

const AUCTION_ENTRY = { abbrev: '$', full: 'Auction Price', desc: 'Estimated dollar value in auction mode, derived from each player\'s share of total VBD value' }

export default function Legend({ auctionMode }) {
  const [open, setOpen] = useState(false)

  const tiersEntry = BASE_ENTRIES.find(e => e.abbrev === 'Tiers')
  const entries = auctionMode
    ? [...BASE_ENTRIES.filter(e => e.abbrev !== 'Tiers'), AUCTION_ENTRY, tiersEntry]
    : BASE_ENTRIES

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
          {entries.map(({ abbrev, full, desc }) => (
            <div key={abbrev} className={styles.entry}>
              <span className={styles.abbrev}>{abbrev}</span>
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
