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

function mockFetch(status, body = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('DraftSync', () => {
  beforeEach(() => {
    // The connect form is collapsed behind the "Sync ESPN draft" button.
    // Tests that need the form open click it first.
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openForm() {
    await userEvent.click(screen.getByRole('button', { name: /Sync ESPN draft/i }))
  }

  it('reports a valid league on a successful pre-flight (200)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { provider: 'espn', picks: [] }))
    render(<DraftSync espnSync={makeSync()} />)
    await openForm()

    await userEvent.type(screen.getByPlaceholderText(/12345678/), '99887766')
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }))

    expect(await screen.findByText(/League reachable/i)).toBeInTheDocument()
  })

  it('flags expired cookies on a 401 pre-flight', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { detail: 'ESPN credentials look expired' }))
    render(<DraftSync espnSync={makeSync()} />)
    await openForm()

    await userEvent.type(screen.getByPlaceholderText(/12345678/), '99887766')
    await userEvent.click(screen.getByRole('button', { name: /Test connection/i }))

    expect(await screen.findByText(/Expired or wrong cookies/i)).toBeInTheDocument()
  })

  it('hides the credential-based Test connection button in mock mode', async () => {
    render(<DraftSync espnSync={makeSync()} />)
    await openForm()

    expect(screen.getByRole('button', { name: /Test connection/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Live ESPN mock draft/i }))
    expect(screen.queryByRole('button', { name: /Test connection/i })).not.toBeInTheDocument()
  })

  it('shows a distinct reconnect affordance when auth expired', async () => {
    const disconnect = vi.fn()
    render(<DraftSync espnSync={makeSync({
      status: 'error', authExpired: true, error: 'ESPN credentials look expired', disconnect,
    })} />)

    expect(screen.getByText(/Credentials expired/i)).toBeInTheDocument()
    const reconnect = screen.getByRole('button', { name: /reconnect/i })
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()

    await userEvent.click(reconnect)
    expect(disconnect).toHaveBeenCalled()
  })

  it('shows a plain retry for non-auth errors', () => {
    render(<DraftSync espnSync={makeSync({
      status: 'error', authExpired: false, error: 'ESPN request timed out',
    })} />)

    expect(screen.getByText(/timed out/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
  })
})
