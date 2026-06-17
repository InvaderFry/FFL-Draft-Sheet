import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function sync(overrides = {}) {
  return {
    status: 'complete',
    teams: [],
    myTeamId: null,
    setMyTeamId: vi.fn(),
    error: null,
    authExpired: false,
    lastSyncAtRef: { current: null },
    pickCount: 0,
    replayTotal: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

function renderBoard(positions, props = {}) {
  return render(
    <ThemeProvider>
      <DraftBoard
        sheetData={{ positions, metadata: { ppr: 0.5 } }}
        config={{ n_teams: 12, auction_mode: false }}
        onPrint={vi.fn()}
        isDrafted={() => false}
        onToggle={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  )
}

function renderWithMetadata(metadata) {
  return render(
    <ThemeProvider>
      <DraftBoard
        sheetData={{ positions: { QB: [], RB: [], WR: [], TE: [], DST: [] }, metadata }}
        config={{ n_teams: 12, auction_mode: false }}
        onPrint={vi.fn()}
        isDrafted={() => false}
        onToggle={vi.fn()}
      />
    </ThemeProvider>
  )
}

describe('DraftBoard', () => {
  it('flags ECR as an ADP proxy when FantasyPros ECR is unavailable', () => {
    renderWithMetadata({ ppr: 0.5, ecr_available: false })
    expect(screen.getByText('ECR: ADP proxy')).toBeInTheDocument()
  })

  it('omits the ECR proxy flag when real ECR is available', () => {
    renderWithMetadata({ ppr: 0.5, ecr_available: true })
    expect(screen.queryByText('ECR: ADP proxy')).not.toBeInTheDocument()
  })

  it('surfaces per-position counts, ADP fallback, and data-quality warnings in source details', async () => {
    const user = userEvent.setup()
    renderWithMetadata({
      ppr: 0.5,
      season: 2026,
      adp_available: true,
      adp_season: 2025,
      data_quality_warnings: ['WR projections appear inflated (early-season data).'],
      source_statuses: [
        {
          source: 'FantasyPros',
          status: 'used',
          used: true,
          positions: ['QB', 'RB', 'WR'],
          position_counts: { QB: 60, RB: 120, WR: 140 },
          failures: [],
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: /1 source/i }))

    expect(screen.getByText('QB 60 · RB 120 · WR 140')).toBeInTheDocument()
    expect(screen.getByText('ADP from 2025 — 2026 not yet published')).toBeInTheDocument()
    expect(
      screen.getByText('WR projections appear inflated (early-season data).')
    ).toBeInTheDocument()
  })

  it('reports ADP unavailable in source details when no ADP loaded', async () => {
    const user = userEvent.setup()
    renderWithMetadata({
      ppr: 0.5,
      season: 2026,
      adp_available: false,
      source_statuses: [
        { source: 'FantasyPros', status: 'used', used: true, positions: ['QB'], position_counts: { QB: 60 }, failures: [] },
      ],
    })

    await user.click(screen.getByRole('button', { name: /1 source/i }))

    expect(screen.getByText('ADP unavailable')).toBeInTheDocument()
  })

  it('derives Val gradients from finite skill-position values only', () => {
    renderBoard({
      QB: [player('Top Skill', 'QB', 40)],
      RB: [player('Lowest Skill', 'RB', 5), player('Null Skill', 'RB', null)],
      WR: [player('NaN Skill', 'WR', NaN)],
      TE: [],
      DST: [player('Defense', 'DST', -100)],
      K: [player('Kicker', 'K', 100)],
    })

    expect(screen.getByText('5.0')).toHaveStyle({ backgroundColor: 'rgba(137, 180, 250, 0.3)' })
    expect(screen.getByText('40.0')).toHaveStyle({ backgroundColor: 'rgba(250, 179, 135, 0.3)' })
  })

  // Search/watch filter the board table only — the RECOMMENDED panel is a
  // global shortlist, so scope these assertions to the table area.
  const tableArea = () => document.querySelector('[class*="tableArea"]')

  it('searches visible rows from the board header', async () => {
    const user = userEvent.setup()
    renderBoard({
      QB: [player('Patrick Mahomes', 'QB', 40), player('Josh Allen', 'QB', 39)],
      RB: [player('Bijan Robinson', 'RB', 35)],
      WR: [],
      TE: [],
      DST: [],
    })

    expect(within(tableArea()).getByText('Patrick Mahomes')).toBeInTheDocument()
    expect(within(tableArea()).getByText('Josh Allen')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: /search players/i }), 'mahomes')

    expect(within(tableArea()).getByText('Patrick Mahomes')).toBeInTheDocument()
    expect(within(tableArea()).queryByText('Josh Allen')).not.toBeInTheDocument()
    expect(within(tableArea()).queryByText('Bijan Robinson')).not.toBeInTheDocument()
  })

  it('filters the board to watched players only', async () => {
    const user = userEvent.setup()
    renderBoard({
      QB: [player('Patrick Mahomes', 'QB', 40), player('Josh Allen', 'QB', 39)],
      RB: [],
      WR: [],
      TE: [],
      DST: [],
    }, {
      isWatched: id => id === 'qb-patrick-mahomes',
    })

    await user.click(screen.getByRole('button', { name: /only/i }))

    expect(within(tableArea()).getByText('Patrick Mahomes')).toBeInTheDocument()
    expect(within(tableArea()).queryByText('Josh Allen')).not.toBeInTheDocument()
  })

  it('only shows Export CSV when My Team has picks', () => {
    const positions = {
      QB: [player('Patrick Mahomes', 'QB', 40)],
      RB: [],
      WR: [],
      TE: [],
      DST: [],
    }
    const draftedList = [{
      id: 'qb-patrick-mahomes',
      name: 'Patrick Mahomes',
      pos: 'QB',
      source: 'espn',
      teamId: 'team-1',
      teamName: 'My Team',
      overall: 4,
    }]

    const { rerender } = renderBoard(positions, {
      espnSync: sync({ myTeamId: 'team-1', pickCount: 1 }),
      draftedList,
    })
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument()

    rerender(
      <ThemeProvider>
        <DraftBoard
          sheetData={{ positions, metadata: { ppr: 0.5 } }}
          config={{ n_teams: 12, auction_mode: false }}
          onPrint={vi.fn()}
          isDrafted={() => false}
          onToggle={vi.fn()}
          espnSync={sync({ myTeamId: 'team-2', pickCount: 1 })}
          draftedList={draftedList}
        />
      </ThemeProvider>
    )
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument()
  })
})
