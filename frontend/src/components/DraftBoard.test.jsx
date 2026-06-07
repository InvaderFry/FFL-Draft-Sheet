import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DraftBoard from './DraftBoard'
import { ThemeProvider } from '../context/ThemeContext'

function player(name, pos, val) {
  return {
    sleeper_id: `${pos}-${name}`.toLowerCase().replaceAll(' ', '-'),
    player_name: name,
    pos,
    team: 'KC',
    bye_week: null,
    val,
    floor: null,
    ceil: null,
    ps_pct: null,
    adp_rank: null,
    ecr_rank: null,
    ecr_fmt: '—',
    tier: 1,
    tier_is_even: false,
    auction_price: null,
  }
}

function renderBoard(positions) {
  return render(
    <ThemeProvider>
      <DraftBoard
        sheetData={{ positions, metadata: { ppr: 0.5 } }}
        config={{ n_teams: 12, auction_mode: false }}
        onPrint={vi.fn()}
        isDrafted={() => false}
        onToggle={vi.fn()}
      />
    </ThemeProvider>
  )
}

describe('DraftBoard', () => {
  it('derives Val gradients from finite skill-position values only', () => {
    renderBoard({
      QB: [player('Top Skill', 'QB', 40)],
      RB: [player('Lowest Skill', 'RB', 5), player('Null Skill', 'RB', null)],
      WR: [player('NaN Skill', 'WR', NaN)],
      TE: [],
      DST: [player('Defense', 'DST', -100)],
      K: [player('Kicker', 'K', 100)],
    })

    expect(screen.getByText('5.0')).toHaveStyle({ backgroundColor: 'rgba(96, 165, 250, 0.3)' })
    expect(screen.getByText('40.0')).toHaveStyle({ backgroundColor: 'rgba(251, 146, 60, 0.3)' })
  })
})
