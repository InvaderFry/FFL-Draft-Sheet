import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function renderTable(players, {
  minVal = 0,
  maxVal = 40,
  strategy = null,
  search = '',
  watchedOnly = false,
  isWatched = () => false,
  toggleWatch = vi.fn(),
  isDrafted = () => false,
  onToggle = vi.fn(),
} = {}) {
  return render(
    <ThemeProvider>
      <PlayerTable
        players={players}
        nTeams={12}
        isDrafted={isDrafted}
        onToggle={onToggle}
        auctionMode={false}
        minVal={minVal}
        maxVal={maxVal}
        strategy={strategy}
        search={search}
        watchedOnly={watchedOnly}
        isWatched={isWatched}
        toggleWatch={toggleWatch}
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

    expect(screen.getByText('(20.0)')).toHaveStyle({ backgroundColor: 'rgba(137, 180, 250, 0.3)' })
    expect(screen.getByText('0.0')).toHaveStyle({ backgroundColor: 'rgba(166, 227, 161, 0.3)' })
    expect(screen.getByText('40.0')).toHaveStyle({ backgroundColor: 'rgba(250, 179, 135, 0.3)' })
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

  it('filters visible rows by player name case-insensitively', () => {
    renderTable([
      player('Patrick Mahomes', 1, false),
      player('Josh Allen', 1, false),
    ], { search: 'allen' })

    expect(screen.getByText('Josh Allen')).toBeInTheDocument()
    expect(screen.queryByText('Patrick Mahomes')).not.toBeInTheDocument()
  })

  it('toggles the star watchlist button without drafting the player', async () => {
    const user = userEvent.setup()
    const toggleWatch = vi.fn()
    const onToggle = vi.fn()
    renderTable([player('Patrick Mahomes', 1, false)], { toggleWatch, onToggle })

    await user.click(screen.getByRole('button', { name: /add patrick mahomes to watchlist/i }))

    expect(toggleWatch).toHaveBeenCalledWith('patrick-mahomes')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('filters to watched players only', () => {
    renderTable([
      player('Watched Sleeper', 1, false),
      player('Unwatched Player', 1, false),
    ], {
      watchedOnly: true,
      isWatched: id => id === 'watched-sleeper',
    })

    expect(screen.getByText('Watched Sleeper')).toBeInTheDocument()
    expect(screen.queryByText('Unwatched Player')).not.toBeInTheDocument()
  })

  describe('survival markers', () => {
    const withAdp = (name, adp) => ({ ...player(name, 1, false), adp_rank: adp })

    it('flags fallen (past-ADP), risky, and safe players; none without ADP', () => {
      const { container } = renderTable([
        withAdp('Fallen', 5),    // adp <= currentPick → already past ADP
        withAdp('Risky', 15),    // currentPick < adp <= nextPick
        withAdp('Safe', 30),     // adp > nextPick
        withAdp('NoAdp', null),  // no ADP → no marker
      ], { strategy: { currentPick: 10, nextPick: 22 } })

      expect(screen.getByTitle(/already past ADP/)).toBeInTheDocument()
      expect(screen.getByTitle(/likely gone before your pick 22/)).toBeInTheDocument()
      expect(screen.getByTitle(/should reach your pick 22/)).toBeInTheDocument()
      // Exactly three rows carry a marker (the no-ADP row has none).
      expect(container.querySelectorAll(`.${styles.survDot}`)).toHaveLength(3)
    })

    it('renders no markers without a strategy context', () => {
      const { container } = renderTable([withAdp('Anyone', 5)])
      expect(container.querySelectorAll(`.${styles.survDot}`)).toHaveLength(0)
    })
  })
})
