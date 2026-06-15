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

function draftResponse({
  picks = [], inProgress = true, complete = false, teams = TEAMS, myTeamId = null,
} = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      provider: 'espn',
      in_progress: inProgress,
      complete,
      picks,
      teams,
      my_team_id: myTeamId,
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

// Backend named the pick (e.g. via ESPN's player directory) but its espn_id
// is missing from the sheet row — and the spelling differs slightly.
const NAME_FALLBACK_PICK = {
  overall: 3, round: 1, round_pick: 3, team_id: '4',
  provider_player_id: '5555555', sleeper_id: null,
  player_name: 'Justin Jefferson Jr.', pos: 'WR', nfl_team: 'MIN',
}

// Backend-named kicker: correct name, but no K rows exist on the sheet.
const KICKER_PICK = {
  overall: 4, round: 2, round_pick: 1, team_id: '7',
  provider_player_id: '7777777', sleeper_id: null,
  player_name: 'Harrison Butker', pos: 'K', nfl_team: 'KC',
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

  function renderSync(sheetData = SHEET) {
    return renderHook(() => useEspnDraftSync({ sheetData, applySyncedPicks }))
  }

  async function flush() {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  function espnDraftPostCall() {
    const call = fetchMock.mock.calls.find(([url, opts]) =>
      String(url).endsWith('/api/draft/espn') && opts?.method === 'POST')
    expect(call).toBeDefined()
    return call
  }

  function espnDraftPostBody() {
    const call = espnDraftPostCall()
    return JSON.parse(call[1].body)
  }

  it('connect() fetches immediately and maps picks onto the sheet', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK, OFFSHEET_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026, espn_s2: '', swid: '' }))
    expect(result.current.status).toBe('connecting')
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = espnDraftPostCall()
    expect(url).toContain('/api/draft/espn')
    expect(JSON.parse(opts.body)).toMatchObject({
      league_id: 123,
      season: 2026,
      espn_s2: null,
      swid: null,
      mock_ingest: false,
    })

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

  it('mock-mode connect posts mock_ingest:true and renders ingested picks', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026, mock: true }))
    await flush()

    expect(espnDraftPostBody()).toMatchObject({
      league_id: 123,
      season: 2026,
      mock_ingest: true,
    })
    expect(result.current.status).toBe('connected')
    expect(result.current.pickCount).toBe(1)
    expect(applySyncedPicks.mock.calls.at(-1)[0][0]).toMatchObject({
      id: 'cmc_sleeper',
      teamName: 'Team Derrick',
      overall: 1,
    })
  })

  it('auto-selects backend-detected my_team_id when none is chosen', async () => {
    fetchMock.mockResolvedValue(draftResponse({
      picks: [CMC_PICK],
      teams: [
        { team_id: '4', name: 'Team 4' },
        { team_id: '7', name: 'Team 7' },
      ],
      myTeamId: 7,
    }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026, mock: true }))
    await flush()

    expect(result.current.teams).toMatchObject([
      { team_id: '4', name: 'Team 4' },
      { team_id: '7', name: 'Team 7' },
    ])
    expect(result.current.myTeamId).toBe('7')
  })

  it('does not override an already-selected team with backend my_team_id', async () => {
    fetchMock
      .mockResolvedValueOnce(draftResponse({ picks: [CMC_PICK] }))
      .mockResolvedValueOnce(draftResponse({ picks: [CMC_PICK], myTeamId: 7 }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026, mock: true }))
    await flush()
    act(() => result.current.setMyTeamId('4'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

    expect(result.current.myTeamId).toBe('4')
  })

  it('does not override a saved team supplied in connect settings', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [CMC_PICK], myTeamId: 7 }))
    const { result } = renderSync()

    act(() => result.current.connect({
      leagueId: '123', season: 2026, mock: true, myTeamId: '4',
    }))
    await flush()

    expect(espnDraftPostBody()).not.toHaveProperty('myTeamId')
    expect(result.current.myTeamId).toBe('4')
  })

  it('matches a backend-named pick to its sheet row by name+pos when espn_id misses', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [NAME_FALLBACK_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()

    const picks = applySyncedPicks.mock.calls.at(-1)[0]
    // Resolved to the sheet's WR row (sleeper_id null → keyed by player_name),
    // using the sheet's canonical spelling, so the board row crosses off.
    expect(picks[0]).toMatchObject({
      id: 'Justin Jefferson', name: 'Justin Jefferson', pos: 'WR',
      teamId: '4', teamName: 'Team Derrick', overall: 3,
    })
  })

  describe('duplicate name+pos on the sheet', () => {
    // Two distinct WRs sharing a name (it happens — the NFL has had two
    // active Mike Williams WRs). 'LA' vs the pick's 'LAR' also exercises
    // the team-code alias normalization.
    const DUPE_SHEET = {
      positions: {
        WR: [
          { sleeper_id: 'mw_rams', espn_id: '111', player_name: 'Mike Williams', pos: 'WR', team: 'LA' },
          { sleeper_id: 'mw_pit', espn_id: '222', player_name: 'Mike Williams', pos: 'WR', team: 'PIT' },
        ],
      },
    }
    const dupePick = (nflTeam) => ({
      overall: 1, round: 1, round_pick: 1, team_id: '4',
      provider_player_id: '333', sleeper_id: null,
      player_name: 'Mike Williams', pos: 'WR', nfl_team: nflTeam,
    })

    it('disambiguates by NFL team (through code aliases)', async () => {
      fetchMock.mockResolvedValue(draftResponse({ picks: [dupePick('LAR')] }))
      const { result } = renderSync(DUPE_SHEET)

      act(() => result.current.connect({ leagueId: '123', season: 2026 }))
      await flush()

      expect(applySyncedPicks.mock.calls.at(-1)[0][0]).toMatchObject({
        id: 'mw_rams', name: 'Mike Williams', pos: 'WR',
      })
    })

    it('stays off-sheet when the team cannot single out a row', async () => {
      fetchMock.mockResolvedValue(draftResponse({ picks: [dupePick(null)] }))
      const { result } = renderSync(DUPE_SHEET)

      act(() => result.current.connect({ leagueId: '123', season: 2026 }))
      await flush()

      // Correctly named, but no board row claimed — neither sleeper_id key.
      expect(applySyncedPicks.mock.calls.at(-1)[0][0]).toMatchObject({
        id: 'Mike Williams', name: 'Mike Williams', pos: 'WR',
      })
    })
  })

  it('keeps a backend-named pick that matches no sheet row as an off-sheet entry', async () => {
    fetchMock.mockResolvedValue(draftResponse({ picks: [KICKER_PICK] }))
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()

    const picks = applySyncedPicks.mock.calls.at(-1)[0]
    expect(picks[0]).toMatchObject({
      id: 'Harrison Butker', name: 'Harrison Butker', pos: 'K',
      teamName: 'Old School Squad', overall: 4,
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

  it('treats 400 as permanent with the server message', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ detail: 'Could not sync this ESPN draft.' }),
    })
    const { result } = renderSync()

    act(() => result.current.connect({ leagueId: '123', season: 2026 }))
    await flush()

    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('Could not sync')
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
