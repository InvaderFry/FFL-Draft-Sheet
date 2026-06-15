import { test, expect } from '@playwright/test'
import { stubSheet } from './helpers'

test.describe('mobile board', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('renders stacked board controls and filters by search', async ({ page }) => {
    await stubSheet(page)
    await page.goto('/')
    await page.getByRole('button', { name: /generate draft sheet/i }).click()

    const board = page.locator('main')
    await expect(board.getByText('Christian McCaffrey')).toBeVisible()

    const tableBox = await board.locator('table').first().boundingBox()
    const draftedBox = await board.getByText('DRAFTED', { exact: true }).boundingBox()
    expect(tableBox).not.toBeNull()
    expect(draftedBox).not.toBeNull()
    expect(draftedBox.y).toBeGreaterThan(tableBox.y)

    await board.getByRole('searchbox', { name: /search players/i }).fill('Bijan')

    await expect(board.getByText('Bijan Robinson')).toBeVisible()
    await expect(board.getByText('Christian McCaffrey')).not.toBeVisible()
  })
})
