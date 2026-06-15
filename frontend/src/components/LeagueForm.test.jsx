import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LeagueForm from './LeagueForm'

function renderForm(overrides = {}) {
  const props = {
    onSheet: vi.fn(),
    onLoading: vi.fn(),
    onError: vi.fn(),
    error: null,
    ...overrides,
  }
  render(<LeagueForm {...props} />)
  return props
}

const submit = () =>
  userEvent.click(screen.getByRole('button', { name: /Generate Draft Sheet/i }))

describe('LeagueForm', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('blocks submit when flex allocations do not sum to 1.0', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { onSheet } = renderForm()

    // "RB" labels both the Starters count and the FLEX-split share; the split
    // input is the second one in the DOM. Defaults sum to 1.0 (0.5/0.4/0.1/0.0);
    // break it with an over-allocated RB share.
    const flexRb = screen.getAllByRole('spinbutton', { name: 'RB' })[1]
    await userEvent.clear(flexRb)
    await userEvent.type(flexRb, '0.9')
    await submit()

    expect(await screen.findByText(/Flex allocations must sum to 1.0/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(onSheet).not.toHaveBeenCalled()
  })

  it('POSTs a well-formed payload and hands the sheet back on success', async () => {
    const sheet = { positions: {}, metadata: {} }
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sheet })
    vi.stubGlobal('fetch', fetch)
    const { onSheet } = renderForm()

    await submit()

    expect(fetch).toHaveBeenCalledOnce()
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toMatch(/\/api\/sheet$/)
    const payload = JSON.parse(opts.body)
    expect(payload.n_teams).toBe(12)
    expect(payload.flex_rb + payload.flex_wr + payload.flex_te + payload.flex_qb).toBeCloseTo(1.0)
    // UI "Half PPR" maps to scoring.rec = 0.5.
    expect(payload.scoring.rec).toBe(0.5)

    await vi.waitFor(() => expect(onSheet).toHaveBeenCalledWith(sheet, payload))
  })

  it('surfaces a backend error via onError without calling onSheet', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ detail: 'projection source down' }),
    })
    vi.stubGlobal('fetch', fetch)
    const { onError, onSheet } = renderForm()

    await submit()

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('projection source down'))
    expect(onSheet).not.toHaveBeenCalled()
  })
})
