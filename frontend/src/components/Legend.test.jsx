import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Legend from './Legend'

async function openGuide() {
  await userEvent.setup().click(screen.getByRole('button', { name: /column guide/i }))
}

describe('Legend', () => {
  it('describes the active shade method and omits line/break entries by default', async () => {
    render(<Legend auctionMode={false} shadeBy="gmm" linesBy="none" manualEdit={false} />)
    await openGuide()

    expect(screen.getByText(/Tier Shading/)).toBeInTheDocument()
    expect(screen.getByText(/using the GMM method/)).toBeInTheDocument()
    expect(screen.queryByText('Tier Line')).not.toBeInTheDocument()
    expect(screen.queryByText('Tier Break')).not.toBeInTheDocument()
  })

  it('explains the colored line when a Lines method is selected', async () => {
    render(<Legend auctionMode={false} shadeBy="jenks" linesBy="gmm" manualEdit={false} />)
    await openGuide()

    expect(screen.getByText('Tier Line')).toBeInTheDocument()
    expect(screen.getByText(/marking GMM tier boundaries/)).toBeInTheDocument()
  })

  it('explains the nudge handles in manual-edit mode', async () => {
    render(<Legend auctionMode={false} shadeBy="manual" linesBy="none" manualEdit />)
    await openGuide()

    expect(screen.getByText('Tier Break')).toBeInTheDocument()
    expect(screen.getByText(/click the handle before a name/)).toBeInTheDocument()
  })
})
