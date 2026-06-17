import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DraftSync from './DraftSync'

// A disconnected, do-nothing sync object; tests override individual fields.
function makeSync(overrides = {}) {
  return {
    status: 'disconnected',
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

// Renders with both providers; pass overrides for whichever one a test drives.
function renderSync({ espn = {}, sleeper = {} } = {}) {
  const espnSync = makeSync(espn)
  const sleeperSync = makeSync(sleeper)
  render(<DraftSync espnSync={espnSync} sleeperSync={sleeperSync} />)
  return { espnSync, sleeperSync }
}

function mockFetch(status, body = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('DraftSync', () => {
  beforeEach(() => {
    // The connect form is collapsed behind the "Sync live draft" button.
    // Tests that need the form open click it first.
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openForm() {
    await userEvent.click(screen.getByRole('button', { name: /Sync live draft/i }))
  }

  async function openSleeper() {
    await openForm()
    await userEvent.click(screen.getByRole('tab', { name: /Sleeper/i }))
  }

  // ---- ESPN (default tab) ------------------------------------------------------

  it('reports a valid league on a successful pre-flight (200)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { provider: 'espn', picks: [] }))
    renderSync()
    await openForm()

    await userEvent.type(screen.getByPlaceholderText(/12345678/), '99887766')
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }))

    expect(await screen.findByText(/League reachable/i)).toBeInTheDocument()
  })

  it('flags expired cookies on a 401 pre-flight', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { detail: 'ESPN credentials look expired' }))
    renderSync()
    await openForm()

    await userEvent.type(screen.getByPlaceholderText(/12345678/), '99887766')
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }))

    expect(await screen.findByText(/Expired or wrong cookies/i)).toBeInTheDocument()
  })

  it('hides the credential-based Test connection button in mock mode', async () => {
    renderSync()
    await openForm()

    expect(screen.getByRole('button', { name: /Test connection/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Live ESPN mock draft/i }))
    expect(screen.queryByRole('button', { name: /Test connection/i })).not.toBeInTheDocument()
  })

  it('carries a saved team choice into connect settings for the same league', async () => {
    const connect = vi.fn()
    localStorage.setItem('beersheet_espn_sync', JSON.stringify({
      leagueId: '99887766',
      season: 2026,
      mock: true,
      myTeamId: '7',
    }))
    renderSync({ espn: { connect } })
    await openForm()

    await userEvent.click(screen.getByRole('button', { name: /^Connect$/i }))

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: '99887766',
      season: 2026,
      mock: true,
      myTeamId: '7',
      espn_s2: '',
      swid: '',
    }))
  })

  it('shows a distinct reconnect affordance when auth expired', async () => {
    const disconnect = vi.fn()
    renderSync({ espn: {
      status: 'error', authExpired: true, error: 'ESPN credentials look expired', disconnect,
    } })

    expect(screen.getByText(/Credentials expired/i)).toBeInTheDocument()
    const reconnect = screen.getByRole('button', { name: /reconnect/i })
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()

    await userEvent.click(reconnect)
    expect(disconnect).toHaveBeenCalled()
  })

  it('shows a plain retry for non-auth errors', () => {
    renderSync({ espn: {
      status: 'error', authExpired: false, error: 'ESPN request timed out',
    } })

    expect(screen.getByText(/timed out/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
  })

  // ---- Sleeper -----------------------------------------------------------------

  it('shows a minimal Sleeper form (Draft ID only, no cookies/season/mock)', async () => {
    renderSync()
    await openSleeper()

    expect(screen.getByText(/Live Sleeper draft sync/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/1109123456789012345/)).toBeInTheDocument()
    // None of ESPN's extra controls belong to the Sleeper form.
    expect(screen.queryByText(/League ID/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Private league/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /mock draft/i })).not.toBeInTheDocument()
  })

  it('connects with the draft id and persists it', async () => {
    const connect = vi.fn()
    renderSync({ sleeper: { connect } })
    await openSleeper()

    await userEvent.type(screen.getByPlaceholderText(/1109123456789012345/), '12345')
    await userEvent.click(screen.getByRole('button', { name: /^Connect$/i }))

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ draftId: '12345' }))
    expect(JSON.parse(localStorage.getItem('beersheet_sleeper_sync'))).toMatchObject({
      draftId: '12345',
    })
  })

  it('reports a reachable Sleeper draft on a successful pre-flight', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { provider: 'sleeper', picks: [] }))
    renderSync()
    await openSleeper()

    await userEvent.type(screen.getByPlaceholderText(/1109123456789012345/), '12345')
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }))

    expect(await screen.findByText(/Draft reachable/i)).toBeInTheDocument()
  })

  it('flags a missing Sleeper draft on a 404 pre-flight', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { detail: 'Sleeper draft 12345 not found.' }))
    renderSync()
    await openSleeper()

    await userEvent.type(screen.getByPlaceholderText(/1109123456789012345/), '12345')
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }))

    expect(await screen.findByText(/Draft not found/i)).toBeInTheDocument()
  })

  it('never shows a credentials-expired chip for a Sleeper error', () => {
    renderSync({ sleeper: { status: 'error', authExpired: false, error: 'Could not reach Sleeper' } })

    expect(screen.getByText(/Could not reach Sleeper/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
    expect(screen.queryByText(/Credentials expired/i)).not.toBeInTheDocument()
  })

  it('renders the team picker and disconnect for a connected Sleeper draft', async () => {
    const disconnect = vi.fn()
    renderSync({ sleeper: {
      status: 'connected', pickCount: 3, disconnect,
      lastSyncAtRef: { current: Date.now() },
      teams: [{ team_id: '1', name: 'Team Derrick' }, { team_id: '2', name: 'Rival Squad' }],
    } })

    expect(screen.getByText(/Live · 3 picks/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Team Derrick' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(disconnect).toHaveBeenCalled()
  })
})
