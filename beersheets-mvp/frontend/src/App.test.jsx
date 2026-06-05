import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

function qb(name, sleeperId) {
  return {
    sleeper_id: sleeperId,
    espn_id: null,
    player_name: name,
    pos: 'QB',
    team: 'KC',
    bye_week: 10,
    val: 50.0,
    floor: 40.0,
    ceil: 60.0,
    ps_pct: 25.0,
    n_sources: 3,
    pos_rank: 1,
    adp_rank: 10,
    ecr_rank: 10,
    ecr_fmt: '1|10',
    tier: 1,
    tier_is_even: false,
    auction_price: null,
  }
}

const SHEET = {
  positions: {
    QB: [qb('Patrick Mahomes', 'mahomes_id'), qb('Josh Allen', 'allen_id')],
    RB: [], WR: [], TE: [], DST: [],
  },
  metadata: {
    season: 2026, n_teams: 12, ppr: 0.5,
    sources_used: ['FantasyPros'], sources_dropped: [],
    baselines: {}, adp_available: true,
    cache_hit: false, generation_time_s: 1.2,
  },
}

const SOURCE_STATUS_SHEET = {
  ...SHEET,
  metadata: {
    ...SHEET.metadata,
    sources_used: ['FantasyPros', 'ESPN'],
    sources_dropped: ['FFToday'],
    source_statuses: [
      {
        source: 'FantasyPros',
        status: 'used',
        used: true,
        positions: ['QB', 'RB'],
        reason: null,
        failures: [],
      },
      {
        source: 'ESPN',
        status: 'partial',
        used: true,
        positions: ['QB'],
        reason: null,
        failures: [{ position: 'TE', reason: 'timeout' }],
      },
      {
        source: 'FFToday',
        status: 'unavailable',
        used: false,
        positions: [],
        reason: 'HTTP 403',
        failures: [{ position: 'RB', reason: 'HTTP 403' }],
      },
    ],
  },
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App — draft state shared between board and print view', () => {
  it('crossing a player off the board also marks them in the print view', async () => {
    const user = userEvent.setup()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => SHEET })

    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: /generate draft sheet/i }))

    // Board renders QB players.
    const board = container.querySelector('main')
    expect(await within(board).findByText('Patrick Mahomes')).toBeInTheDocument()

    // Print view is always mounted alongside; same player present.
    const printRoot = container.querySelector('.print-sheet')
    const printRowBefore = within(printRoot).getByText('Patrick Mahomes').closest('tr')
    expect(printRowBefore.className).not.toContain('drafted')

    // Click the board row to mark drafted.
    const boardRow = within(board).getByText('Patrick Mahomes').closest('tr')
    await user.click(boardRow)

    // Board shows the drafted marker…
    expect(within(board).getByText('✕')).toBeInTheDocument()
    // …and the SAME state is reflected in the print view (regression test).
    await waitFor(() => {
      const printRow = within(printRoot).getByText('Patrick Mahomes').closest('tr')
      expect(printRow.className).toContain('drafted')
    })

    // The other player remains undrafted in both views.
    const allenPrintRow = within(printRoot).getByText('Josh Allen').closest('tr')
    expect(allenPrintRow.className).not.toContain('drafted')
  })

  it('clears draft state when starting a new sheet', async () => {
    const user = userEvent.setup()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => SHEET })

    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: /generate draft sheet/i }))

    const board = container.querySelector('main')
    const boardRow = within(board).findByText('Patrick Mahomes')
    await user.click((await boardRow).closest('tr'))
    expect(within(board).getByText('✕')).toBeInTheDocument()

    // New Sheet resets everything.
    await user.click(screen.getByRole('button', { name: /new sheet/i }))
    await user.click(screen.getByRole('button', { name: /generate draft sheet/i }))

    const board2 = container.querySelector('main')
    await within(board2).findByText('Patrick Mahomes')
    expect(within(board2).queryByText('✕')).not.toBeInTheDocument()
  })
})

describe('App — error handling', () => {
  it('surfaces a fetch error instead of hanging on the spinner', async () => {
    const user = userEvent.setup()
    global.fetch = vi.fn().mockRejectedValue(new Error('Network boom'))

    render(<App />)
    await user.click(screen.getByRole('button', { name: /generate draft sheet/i }))

    // Error message appears…
    expect(await screen.findByText('Network boom')).toBeInTheDocument()
    // …the loading spinner text is gone…
    expect(screen.queryByText(/crunching projections/i)).not.toBeInTheDocument()
    // …and the form is still available to retry.
    expect(screen.getByRole('button', { name: /generate draft sheet/i })).toBeInTheDocument()
  })

  it('shows a server error detail message', async () => {
    const user = userEvent.setup()
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'baseline blew up' }),
    })

    render(<App />)
    await user.click(screen.getByRole('button', { name: /generate draft sheet/i }))

    expect(await screen.findByText('baseline blew up')).toBeInTheDocument()
  })
})

describe('App — source details', () => {
  it('opens a source details panel with used and unavailable sources', async () => {
    const user = userEvent.setup()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => SOURCE_STATUS_SHEET })

    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: /generate draft sheet/i }))

    const board = container.querySelector('main')
    const sourceButton = await within(board).findByRole('button', { name: /2 sources/i })
    expect(sourceButton).toHaveAttribute('aria-expanded', 'false')

    await user.click(sourceButton)

    expect(sourceButton).toHaveAttribute('aria-expanded', 'true')
    const panel = within(board).getByRole('region', { name: /source details/i })
    expect(within(panel).getByText('FantasyPros')).toBeInTheDocument()
    expect(within(panel).getByText('ESPN')).toBeInTheDocument()
    expect(within(panel).getByText(/TE: timeout/)).toBeInTheDocument()
    expect(within(panel).getByText('FFToday')).toBeInTheDocument()
    expect(within(panel).getByText('HTTP 403')).toBeInTheDocument()
  })

  it('falls back to legacy source metadata', async () => {
    const user = userEvent.setup()
    const legacySheet = {
      ...SHEET,
      metadata: {
        ...SHEET.metadata,
        sources_used: ['FantasyPros'],
        sources_dropped: ['NumberFire'],
      },
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => legacySheet })

    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: /generate draft sheet/i }))
    const board = container.querySelector('main')

    await user.click(await within(board).findByRole('button', { name: /1 source/i }))

    const panel = within(board).getByRole('region', { name: /source details/i })
    expect(within(panel).getByText('FantasyPros')).toBeInTheDocument()
    expect(within(panel).getByText('NumberFire')).toBeInTheDocument()
  })

  it('shows zero available sources without implying a successful source count', async () => {
    const user = userEvent.setup()
    const emptySourceSheet = {
      ...SHEET,
      metadata: {
        ...SHEET.metadata,
        sources_used: [],
        sources_dropped: ['FantasyPros'],
        source_statuses: [{
          source: 'FantasyPros',
          status: 'unavailable',
          used: false,
          positions: [],
          reason: '0 rows',
          failures: [{ position: 'QB', reason: '0 rows' }],
        }],
      },
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => emptySourceSheet })

    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: /generate draft sheet/i }))
    const board = container.querySelector('main')

    await user.click(await within(board).findByRole('button', { name: /0 sources/i }))

    const panel = within(board).getByRole('region', { name: /source details/i })
    expect(within(panel).getByText('No sources contributed rows.')).toBeInTheDocument()
    expect(within(panel).getByText('0 rows')).toBeInTheDocument()
  })
})
