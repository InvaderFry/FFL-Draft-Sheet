import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DraftedPanel from './DraftedPanel'

const MANUAL = { id: 'm1', name: 'Manual Guy', pos: 'WR', source: 'manual' }
const SYNCED_MINE = {
  id: 's1', name: 'Christian McCaffrey', pos: 'RB',
  source: 'espn', teamId: '4', teamName: 'Team Derrick', overall: 1,
}
const SYNCED_OTHER = {
  id: 's2', name: 'Justin Jefferson', pos: 'WR',
  source: 'espn', teamId: '7', teamName: 'Old School Squad', overall: 2,
}

describe('DraftedPanel', () => {
  it('manual entries are clickable to undo', async () => {
    const onToggle = vi.fn()
    render(<DraftedPanel draftedList={[MANUAL]} onToggle={onToggle} />)

    await userEvent.click(screen.getByText('Manual Guy'))
    expect(onToggle).toHaveBeenCalledWith('m1', 'Manual Guy', 'WR')
  })

  it('synced entries are locked while sync is active', async () => {
    const onToggle = vi.fn()
    const onRemove = vi.fn()
    render(
      <DraftedPanel
        draftedList={[SYNCED_OTHER]}
        onToggle={onToggle}
        onRemove={onRemove}
        syncActive
      />
    )

    expect(screen.getByText('Old School Squad')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Justin Jefferson'))
    expect(onToggle).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    expect(
      screen.getByTitle('Synced from ESPN — undo in your draft room')
    ).toBeInTheDocument()
  })

  it('synced entries become removable once sync is no longer active', async () => {
    const onToggle = vi.fn()
    const onRemove = vi.fn()
    render(
      <DraftedPanel
        draftedList={[SYNCED_OTHER]}
        onToggle={onToggle}
        onRemove={onRemove}
        syncActive={false}
      />
    )

    await userEvent.click(screen.getByText('Justin Jefferson'))
    expect(onRemove).toHaveBeenCalledWith('s2')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('shows a MY TEAM section filtered to my picks when myTeamId is set', () => {
    render(
      <DraftedPanel
        draftedList={[SYNCED_OTHER, SYNCED_MINE, MANUAL]}
        onToggle={() => {}}
        myTeamId="4"
      />
    )

    const myHeader = screen.getByText('MY TEAM')
    const myList = myHeader.nextElementSibling
    expect(within(myList).getByText('Christian McCaffrey')).toBeInTheDocument()
    expect(within(myList).queryByText('Justin Jefferson')).toBeNull()
    expect(within(myList).queryByText('Manual Guy')).toBeNull()

    // Full drafted list still shows everyone
    expect(screen.getAllByText('Justin Jefferson')).toHaveLength(1)
    expect(screen.getAllByText('Christian McCaffrey')).toHaveLength(2)
  })

  it('hides the MY TEAM section when no team is chosen', () => {
    render(<DraftedPanel draftedList={[SYNCED_MINE]} onToggle={() => {}} />)
    expect(screen.queryByText('MY TEAM')).toBeNull()
  })

  it('renders a RECOMMENDED section and marks a pick drafted on click', async () => {
    const onToggle = vi.fn()
    const recommendations = [
      {
        player: { sleeper_id: 'r1', player_name: 'Bijan Robinson', pos: 'RB', val: 42 },
        score: 50,
        reasons: { primary: 'Fills RB need (0/2)', all: ['Fills RB need (0/2)', 'Top value (VAL 42)'] },
      },
    ]
    render(
      <DraftedPanel draftedList={[]} onToggle={onToggle} recommendations={recommendations} />
    )

    expect(screen.getByText('RECOMMENDED')).toBeInTheDocument()
    expect(screen.getByText('Fills RB need (0/2)')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Bijan Robinson'))
    expect(onToggle).toHaveBeenCalledWith('r1', 'Bijan Robinson', 'RB')
  })

  it('omits the RECOMMENDED section when there are no recommendations', () => {
    render(<DraftedPanel draftedList={[]} onToggle={() => {}} recommendations={[]} />)
    expect(screen.queryByText('RECOMMENDED')).toBeNull()
  })

  it('renders the strategy block: next pick, roster needs, runs, bye conflicts', () => {
    render(
      <DraftedPanel
        draftedList={[SYNCED_MINE]}
        onToggle={() => {}}
        myTeamId="4"
        nextPick={22}
        needs={{
          positions: { QB: { filled: 0, need: 1 }, RB: { filled: 2, need: 2 }, WR: { filled: 0, need: 3 }, TE: { filled: 0, need: 1 }, DST: { filled: 0, need: 1 } },
          flex: { filled: 0, need: 1 },
          byeConflicts: [{ week: 9, count: 2, names: ['A', 'B'] }],
        }}
        runs={{ RB: 4, WR: 2, QB: 0, TE: 0, DST: 0 }}
      />
    )

    expect(screen.getByText('#22')).toBeInTheDocument()
    expect(screen.getByText('RB 2/2')).toBeInTheDocument()
    expect(screen.getByText('WR 0/3')).toBeInTheDocument()
    expect(screen.getByText('FLX 0/1')).toBeInTheDocument()
    expect(screen.getByText(/4 RB, 2 WR off the board/)).toBeInTheDocument()
    expect(screen.getByText(/2 starters on bye wk 9/)).toBeInTheDocument()
  })
})
