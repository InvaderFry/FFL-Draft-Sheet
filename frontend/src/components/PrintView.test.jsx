import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PrintView from './PrintView'

const player = {
  sleeper_id: 'cmc',
  player_name: 'Christian McCaffrey',
  pos: 'RB',
  team: 'SF',
  bye_week: 9,
  val: 25,
  floor: 18,
  ceil: 31,
  ps_pct: 72,
  adp_rank: 4,
  ecr_rank: 3,
  ecr_fmt: '1|03',
  tier: 1,
  tier_is_even: false,
  auction_price: 42,
}

const dstPlayer = {
  sleeper_id: 'sf-dst',
  player_name: 'San Francisco 49ers',
  pos: 'DST',
  team: 'SF',
  bye_week: 9,
  val: 7,
  floor: 3,
  ceil: 10,
  ps_pct: 25,
  adp_rank: 120,
  ecr_rank: 110,
  ecr_fmt: '10|02',
  tier: 1,
  tier_is_even: false,
  auction_price: 3,
}

describe('PrintView', () => {
  it('prints auction prices for auction leagues', () => {
    render(
      <PrintView
        sheetData={{ positions: { QB: [], RB: [player], WR: [], TE: [], DST: [dstPlayer] }, metadata: {} }}
        config={{ n_teams: 12, RB: 2, auction_mode: true, scoring: { rec: 0.5 } }}
        isDrafted={() => false}
      />
    )

    const rbSection = screen.getByText('RUNNING BACK').closest('section')
    expect(within(rbSection).getByText('$')).toBeInTheDocument()
    expect(within(rbSection).getByText('$42')).toBeInTheDocument()
    const dstSection = screen.getByText('DEFENSE / SPECIAL TEAMS').closest('section')
    expect(within(dstSection).getByText('San Francisco 49ers')).toBeInTheDocument()
    expect(within(dstSection).getByText('$3')).toBeInTheDocument()
    expect(screen.getByText('$:')).toBeInTheDocument()
  })

  it('includes configured roster and scoring details in the print summary', () => {
    render(
      <PrintView
        sheetData={{ positions: { QB: [], RB: [], WR: [], TE: [], DST: [] }, metadata: {} }}
        config={{
          n_teams: 10,
          QB: 1,
          RB: 2,
          WR: 2,
          TE: 1,
          DST: 1,
          K: 1,
          flex_slots: 2,
          scoring: {
            rec: 1,
            pass_td: 6,
            pass_yds: 0.05,
            interception: -1,
            rush_td: 6,
            rush_yds: 0.1,
            rec_td: 6,
            rec_yds: 0.1,
            fumble_lost: -3,
            te_premium: 0.5,
          },
        }}
        isDrafted={() => false}
      />
    )

    expect(screen.getByText(/1DST\(10\)/)).toBeInTheDocument()
    expect(screen.getByText(/1K\(10\)/)).toBeInTheDocument()
    expect(screen.getByText(/0.5 TE premium/)).toBeInTheDocument()
    expect(screen.getByText(/Turnovers: -3 Fum Lost/)).toBeInTheDocument()
  })

  it('renders when the backend omits positions', () => {
    render(
      <PrintView
        sheetData={{ metadata: {} }}
        config={{ n_teams: 12, scoring: { rec: 0.5 } }}
        isDrafted={() => false}
      />
    )

    expect(screen.getByText(/ZSheet/)).toBeInTheDocument()
  })

  it('shades the full Val range continuously, including mid-range values', () => {
    const lowValPlayer = { ...player, sleeper_id: 'low', player_name: 'Low Value', val: -20, floor: null, ceil: null }
    const midValPlayer = { ...player, sleeper_id: 'mid', player_name: 'Mid Value', pos: 'QB', val: 10, floor: null, ceil: null }
    const highValPlayer = { ...player, sleeper_id: 'high', player_name: 'High Value', pos: 'WR', val: 40, floor: null, ceil: null }

    render(
      <PrintView
        sheetData={{ positions: { QB: [midValPlayer], RB: [lowValPlayer], WR: [highValPlayer], TE: [], DST: [] }, metadata: {} }}
        config={{ n_teams: 12, RB: 2, WR: 3, auction_mode: false, scoring: { rec: 0.5 } }}
        isDrafted={() => false}
      />
    )

    // Endpoints keep their blue/orange colors; alpha is now a uniform 0.30.
    expect(screen.getByText('-20.0')).toHaveStyle({ backgroundColor: 'rgba(37, 99, 235, 0.3)' })
    expect(screen.getByText('40.0')).toHaveStyle({ backgroundColor: 'rgba(234, 88, 12, 0.3)' })
    // Mid-range value (t=0.5) is now colored too, where it used to be blank.
    expect(screen.getByText('10.0')).toHaveStyle({ backgroundColor: 'rgba(112, 151, 39, 0.3)' })
  })
})
