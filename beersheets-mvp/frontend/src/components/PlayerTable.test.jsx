import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlayerTable from './PlayerTable'
import styles from './PlayerTable.module.css'
import { ThemeProvider } from '../context/ThemeContext'

function player(name, tier, tierIsEven) {
  return {
    sleeper_id: name.toLowerCase().replaceAll(' ', '-'),
    player_name: name,
    pos: 'QB',
    team: 'KC',
    bye_week: 10,
    val: tier === 8 ? 0 : 40 - tier,
    floor: 0,
    ceil: 0,
    ps_pct: 0,
    adp_rank: null,
    ecr_rank: null,
    ecr_fmt: '—',
    tier,
    tier_is_even: tierIsEven,
    auction_price: null,
  }
}

function renderTable(players) {
  return render(
    <ThemeProvider>
      <PlayerTable
        players={players}
        nTeams={12}
        isDrafted={() => false}
        onToggle={vi.fn()}
        auctionMode={false}
        maxVal={40}
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
})
