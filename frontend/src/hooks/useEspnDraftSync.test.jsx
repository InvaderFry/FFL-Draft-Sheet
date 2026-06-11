import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEspnDraftSync } from './useEspnDraftSync'

const SHEET = {
  positions: {
    RB: [
      { sleeper_id: 'cmc_sleeper', espn_id: '3929630', player_name: 'Christian McCaffrey', pos: 'RB' },
    ],
    WR: [
      { sleeper_id: null, espn_id: '4262921', player_name: 'Justin Jefferson', pos: 'WR' },
    ],
  },
}

const TEAMS = [
  { team_id: '4', name: 'Team Derrick', abbrev: 'ZD' },
  { team_id: '7', name: 'Old School Squad', abbrev: 'OLD' },
]

function draftResponse({ picks = [], inProgress = true, complete = false } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      provider: 'espn',
      in_progress: inProgress,
      complete,
      picks,
      teams: TEAMS,
      fetched_at: Date.now() / 1000,
    }),
  }
}

const CMC_PICK = {
  overall: 1, round: 1, round_pick: 1, team_id: '4',
  provider_player_id: '3929630', sleeper_id: '4034',
  player_name: 'Christian McCaffrey', pos: 'RB', nfl_team: 'SF',
}

const OFFSHEET_PICK = {
  overall: 2, round: 1, round_pick: 2, team_id: '7',
  provider_player_id: '9999999', sleeper_id: null,
  player_name: null, pos: null, nfl_team: null,
}

describe('useEspnDraftSync', () => {
  let fetchMock
  let applySyncedPicks

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    applySyncedPicks = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function renderSync() {
    return renderHook(() => useEspnDraftSync({ sheetData: SHEET, applySyncedPicks }))
  }

  async function flush() {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  it('connect() fetches immediately and maps picks onto the sheet', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK, OFFSHEET_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026, espn_s2: '', swid: '' }))
    expect(result.current.status).toBe('connecting')
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/draft/espn')
    expect(JSON.parse(opts.body)).toMatchObject({ league_id: 123, season: 2026, espn_s2: null, swid: null })

    expect(result.current.status).toBe('connected')
    expect(result.current.pickCount).toBe(2)
    expect(result.current.teams).toEqual(TEAMS)

    const picks = applySyncedPicks.mock.calls.at(-1)[0]
    // On-sheet pick uses the board's row key (sleeper_id)
    expect(picks[0]).toMatchObject({
      id: 'cmc_sleeper', name: 'Christian McCaffrey', pos: 'RB',
      teamId: '4', teamName: 'Team Derrick', overall: 1,
    })
    // Off-sheet unknown pick gets a synthetic id and fallback name
    expect(picks[1]).toMatchObject({
      id: 'espn:9999999', name: 'ESPN pick #2', teamName: 'Old School Squad',
    })
  })

  it('polls on an interval while the draft is live', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops polling when the draft completes', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK], inProgress: false, complete: true }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()
    expect(result.current.status).toBe('complete')

    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('backs off on failures and only errors after repeated ones, then recovers', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()
    // 1 failure → still trying quietly
    expect(result.current.status).toBe('connecting')

    await act(async () => { await vi.advanceTimersByTimeAsync(10000) }) // 2nd attempt
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) }) // 3rd attempt
    expect(result.current.status).toBe('error')

    // A later successful poll self-heals
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(40000) })
    expect(result.current.status).toBe('connected')
    expect(result.current.error).toBe(null)
  })

  it('treats 401 as permanent and stops polling', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ detail: 'ESPN denied access to this league.' }),
    })
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()

    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('ESPN denied access')
    await act(async () => { await vi.advanceTimersByTimeAsync(120000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pauses while the tab is hidden and resumes on visibility', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(fetchMock).toHaveBeenCalledTimes(1) // no polls while hidden

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2) // immediate fetch on return
  })

  it('disconnect() stops polling and resets state', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()
    act(() => result.current.disconnect())

    expect(result.current.status).toBe('disconnected')
    expect(result.current.teams).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('abandons a poll response that resolves after disconnect()', async () => {
    let resolveFetch
    fetchMock.mockReturnValue(new Promise(r => { resolveFetch = r }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    act(() => result.current.disconnect())
    expect(result.current.status).toBe('disconnected')

    await act(async () => {
      resolveFetch(draftResponse({ picks: [CMC_PICK] }))
      await vi.advanceTimersByTimeAsync(0)
    })

    // The late response must not resurrect state or apply picks.
    expect(applySyncedPicks).not.toHaveBeenCalled()
    expect(result.current.status).toBe('disconnected')
    expect(result.current.pickCount).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not re-arm polling when the tab hides during an in-flight poll', async () => {
    let resolveFetch
    fetchMock.mockReturnValueOnce(new Promise(r => { resolveFetch = r }))
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))

    // Hide while the first fetch is still in flight, then let it resolve.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => {
      resolveFetch(draftResponse({ picks: [CMC_PICK] }))
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(fetchMock).toHaveBeenCalledTimes(1) // no hidden-tab polling

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resumes a soft-error session on visibility return', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(result.current.status).toBe('error')

    // Hide (cancels the pending backoff timer), backend recovers, return.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()

    expect(result.current.status).toBe('connected')
  })

  it('treats 422 as permanent with a readable message', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({ detail: [{ loc: ['body', 'season'], msg: 'ge=2018' }] }),
    })
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: '' }))
    await flush()

    expect(result.current.status).toBe('error')
    expect(result.current.error).not.toContain('[object Object]')
    expect(result.current.error).toContain('Invalid league ID or season')
    await act(async () => { await vi.advanceTimersByTimeAsync(120000) })
    expect(fetchMock).toHaveBeenCalledTimes(1) // no retries of an invalid payload
  })

  it('practice replay deals a completed draft pick-by-pick from one fetch', async () => {
    fetchMock.mockResolvedValue(draftResponse({
      picks: [CMC_PICK, OFFSHEET_PICK], inProgress: false, complete: true,
    }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2025, practice: true }))
    await flush()

    // Connected with the draft held back — nothing dealt yet.
    expect(result.current.status).toBe('connected')
    expect(result.current.replayTotal).toBe(2)
    expect(result.current.pickCount).toBe(0)
    expect(applySyncedPicks.mock.calls.at(-1)[0]).toEqual([])

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(result.current.pickCount).toBe(1)
    expect(applySyncedPicks.mock.calls.at(-1)[0]).toMatchObject([{ id: 'cmc_sleeper' }])
    expect(result.current.status).toBe('connected')

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(result.current.pickCount).toBe(2)
    expect(result.current.status).toBe('complete')

    // The replay never refetches and stops for good at the last pick.
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.pickCount).toBe(2)
  })

  it('practice connect to an incomplete draft falls back to live polling', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026, practice: true }))
    await flush()

    expect(result.current.replayTotal).toBe(null)
    expect(result.current.pickCount).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('disconnect() mid-replay stops dealing picks', async () => {
    fetchMock.mockResolvedValue(draftResponse({
      picks: [CMC_PICK, OFFSHEET_PICK], inProgress: false, complete: true,
    }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2025, practice: true }))
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(result.current.pickCount).toBe(1)

    act(() => result.current.disconnect())
    expect(result.current.status).toBe('disconnected')
    expect(result.current.replayTotal).toBe(null)

    const applies = applySyncedPicks.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(applySyncedPicks.mock.calls.length).toBe(applies)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends cookies from settings in the request body', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [] }))
    const { result } = renderSync()

    act(() => result.current.connect({
      leagueId: '123', season: 2026, espn_s2: 's2value', swid: '{SWID}',
    }))
    await flush()

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      espn_s2: 's2value', swid: '{SWID}',
    })
  })
})
