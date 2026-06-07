import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlayerTable from './PlayerTable'
import styles from './PlayerTable.module.css'
import { ThemeProvider } from '../context/ThemeContext'

function player(name, tier, tierIsEven, val = tier === 8 ? 0 : 40 - tier) {
  return {
    sleeper_id: name.toLowerCase().replaceAll(' ', '-'),
    player_name: name,
    pos: 'QB',
    team: 'KC',
    bye_week: 10,
    val,
    floor: null,
    ceil: null,
    ps_pct: 0,
    adp_rank: null,
    ecr_rank: null,
    ecr_fmt: '—',
    tier,
    tier_is_even: tierIsEven,
    auction_price: null,
  }
}

function renderTable(players, { minVal = 0, maxVal = 40 } = {}) {
  return render(
    <ThemeProvider>
      <PlayerTable
        players={players}
        nTeams={12}
        isDrafted={() => false}
        onToggle={vi.fn()}
        auctionMode={false}
        minVal={minVal}
        maxVal={maxVal}
      />
    </ThemeProvider>
  )
}

describe('PlayerTable', () => {
  it('marks tier starts even when skipped tiers share the same shading parity', () => {
    renderTable([
      player('Tier One', 1, false),
      player('Tier Two', 2, true),
      player('Baseline', 8, true),
    ])

    const tierTwoRow = screen.getByText('Tier Two').closest('tr')
    const baselineRow = screen.getByText('Baseline').closest('tr')

    expect(tierTwoRow.className).toContain(styles.tierStart)
    expect(baselineRow.className).toContain(styles.tierStart)
  })

  it('uses the full positive and negative Val range for cell gradients', () => {
    renderTable([
      player('Lowest', 1, false, -20),
      player('Middle', 2, true, 0),
      player('Highest', 3, false, 40),
    ], { minVal: -20, maxVal: 40 })

    expect(screen.getByText('(20.0)')).toHaveStyle({ backgroundColor: 'rgba(96, 165, 250, 0.3)' })
    expect(screen.getByText('0.0')).toHaveStyle({ backgroundColor: 'rgba(148, 159, 187, 0.3)' })
    expect(screen.getByText('40.0')).toHaveStyle({ backgroundColor: 'rgba(251, 146, 60, 0.3)' })
  })

  it('omits Val gradient styles when all values share the same range endpoint', () => {
    renderTable([
      player('Same One', 1, false, 12),
      player('Same Two', 2, true, 12),
    ], { minVal: 12, maxVal: 12 })

    const valCells = screen.getAllByText('12.0')
    expect(valCells[0]).not.toHaveStyle({ backgroundColor: 'rgba(96, 165, 250, 0.3)' })
    expect(valCells[0].style.backgroundColor).toBe('')
    expect(valCells[1].style.backgroundColor).toBe('')
  })
})
