import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSleeperDraftSync } from './useSleeperDraftSync'

const SHEET = {
  positions: {
    RB: [
      { sleeper_id: '4034', player_name: 'Christian McCaffrey', pos: 'RB', team: 'SF' },
    ],
    WR: [
      { sleeper_id: null, player_name: 'Justin Jefferson', pos: 'WR', team: 'MIN' },
    ],
  },
}

const TEAMS = [
  { team_id: '1', name: 'Team Derrick', abbrev: null },
  { team_id: '2', name: 'Rival Squad', abbrev: null },
]

function draftResponse({
  picks = [], inProgress = true, complete = false, teams = TEAMS, myTeamId = null,
} = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      provider: 'sleeper',
      in_progress: inProgress,
      complete,
      picks,
      teams,
      my_team_id: myTeamId,
      fetched_at: Date.now() / 1000,
    }),
  }
}

// On-sheet pick: sleeper_id matches a board row directly.
const CMC_PICK = {
  overall: 1, round: 1, round_pick: 1, team_id: '1',
  provider_player_id: '4034', sleeper_id: '4034',
  player_name: 'Christian McCaffrey', pos: 'RB', nfl_team: 'SF',
}

// Off-sheet DST: named (so keyed by its name) but absent from the sheet.
const DST_PICK = {
  overall: 2, round: 1, round_pick: 2, team_id: '2',
  provider_player_id: 'DEN', sleeper_id: null,
  player_name: 'DEN DST', pos: 'DST', nfl_team: 'DEN',
}

// Fully unidentified pick (no sleeper_id, no name) → synthetic sleeper: id.
const UNKNOWN_PICK = {
  overall: 3, round: 1, round_pick: 3, team_id: '2',
  provider_player_id: '9999999', sleeper_id: null,
  player_name: null, pos: null, nfl_team: null,
}

// Backend named the pick but its sleeper_id is missing from the sheet row, and
// the spelling differs slightly → resolved via name+pos fallback.
const NAME_FALLBACK_PICK = {
  overall: 3, round: 1, round_pick: 3, team_id: '1',
  provider_player_id: '6794', sleeper_id: '6794',
  player_name: 'Justin Jefferson Jr.', pos: 'WR', nfl_team: 'MIN',
}

describe('useSleeperDraftSync', () => {
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

  function renderSync(sheetData = SHEET) {
    return renderHook(() => useSleeperDraftSync({ sheetData, applySyncedPicks }))
  }

  async function flush() {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  function sleeperPostCall() {
    const call = fetchMock.mock.calls.find(([url, opts]) =>
      String(url).endsWith('/api/draft/sleeper') && opts?.method === 'POST')
    expect(call).toBeDefined()
    return call
  }

  it('connect() fetches immediately and maps picks by sleeper_id', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK, DST_PICK, UNKNOWN_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ draftId: '999' }))
    expect(result.current.status).toBe('connecting')
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = sleeperPostCall()
    expect(url).toContain('/api/draft/sleeper')
    expect(JSON.parse(opts.body)).toEqual({ draft_id: '999' })

    expect(result.current.status).toBe('connected')
    expect(result.current.pickCount).toBe(3)
    expect(result.current.teams).toEqual(TEAMS)

    const picks = applySyncedPicks.mock.calls.at(-1)[0]
    // On-sheet pick keyed by sleeper_id crosses off the board row.
    expect(picks[0]).toMatchObject({
      id: '4034', name: 'Christian McCaffrey', pos: 'RB',
      teamId: '1', teamName: 'Team Derrick', overall: 1,
    })
    // Off-sheet but named DST → keyed by its name, shows in the drafted list.
    expect(picks[1]).toMatchObject({
      id: 'DEN DST', name: 'DEN DST', pos: 'DST',
      teamName: 'Rival Squad', overall: 2,
    })
    // Fully unidentified pick → synthetic sleeper: id and fallback name.
    expect(picks[2]).toMatchObject({
      id: 'sleeper:9999999', name: 'Sleeper pick #3', overall: 3,
    })
  })

  it('matches a backend-named pick to its sheet row by name+pos when sleeper_id misses', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [NAME_FALLBACK_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ draftId: '999' }))
    await flush()

    const picks = applySyncedPicks.mock.calls.at(-1)[0]
    // The WR sheet row has sleeper_id null (keyed by player_name) and a slightly
    // different spelling, so the bySleeperId miss falls through to name+pos.
    expect(picks[0]).toMatchObject({
      id: 'Justin Jefferson', name: 'Justin Jefferson', pos: 'WR',
      teamId: '1', teamName: 'Team Derrick', overall: 3,
    })
  })

  it('auto-selects backend-detected my_team_id when none is chosen', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK], myTeamId: 2 }))
    const { result } = renderSync()

    act(() => result.current.connect({ draftId: '999' }))
    await flush()

    expect(result.current.myTeamId).toBe('2')
  })

  it('polls on an interval while the draft is live', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ draftId: '999' }))
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

    act(() => result.current.connect({ draftId: '999' }))
    await flush()
    expect(result.current.status).toBe('complete')

    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('backs off on failures and only errors after repeated ones, then recovers', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))
    const { result } = renderSync()

    act(() => result.current.connect({ draftId: '999' }))
    await flush()
    expect(result.current.status).toBe('connecting')

    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(result.current.status).toBe('error')

    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(40000) })
    expect(result.current.status).toBe('connected')
    expect(result.current.error).toBe(null)
  })

  it('treats 404 as permanent and stops polling (no authExpired)', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ detail: 'Sleeper draft 999 not found.' }),
    })
    const { result } = renderSync()

    act(() => result.current.connect({ draftId: '999' }))
    await flush()

    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('not found')
    expect(result.current.authExpired).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(120000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pauses while the tab is hidden and resumes on visibility', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ draftId: '999' }))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('disconnect() stops polling and resets state', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ draftId: '999' }))
    await flush()
    act(() => result.current.disconnect())

    expect(result.current.status).toBe('disconnected')
    expect(result.current.teams).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
