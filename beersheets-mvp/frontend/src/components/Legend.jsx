import { useState } from 'react'
import styles from './Legend.module.css'

const BASE_ENTRIES = [
  { abbrev: 'TM/BW',  full: 'Team / Bye Week',        desc: 'NFL team abbreviation and the team\'s bye week number' },
  { abbrev: 'ECR',    full: 'Expert Consensus Rank',   desc: 'Draft position shown as Round|Pick (e.g. 3|07). Blue = experts rank player >1 round earlier than ADP; Orange = >1 round later than ADP' },
  { abbrev: 'F',      full: 'Floor',                   desc: 'Projected points minus one standard deviation, above the positional baseline (pessimistic outcome)' },
  { abbrev: 'VAL',    full: 'Value',                   desc: 'Mean projected points above the positional replacement baseline — the core VBD metric' },
  { abbrev: 'C',      full: 'Ceiling',                 desc: 'Projected points plus one standard deviation, above the positional baseline (optimistic outcome)' },
  { abbrev: 'PS%',    full: 'Positional Scarcity',     desc: '% of total positive positional value remaining after this player is drafted. Lower % = more urgent pick' },
  { abbrev: 'Tiers',  full: 'Tier Shading',            desc: 'Alternating light/dark row shading groups players of similar projected value using Jenks natural breaks' },
]

const AUCTION_ENTRY = { abbrev: '$', full: 'Auction Price', desc: 'Estimated dollar value in auction mode, derived from each player\'s share of total VBD value' }

export default function Legend({ auctionMode }) {
  const [open, setOpen] = useState(false)

  const entries = auctionMode
    ? [...BASE_ENTRIES.slice(0, -1), AUCTION_ENTRY, BASE_ENTRIES[BASE_ENTRIES.length - 1]]
    : BASE_ENTRIES

  return (
    <div className={styles.legend}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        Column Guide {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className={styles.grid}>
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
