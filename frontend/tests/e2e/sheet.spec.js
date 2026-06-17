import { test, expect } from '@playwright/test'
import { stubSheet } from './helpers'

test.describe('sheet generation', () => {
  test('generates a board and renders players across positions', async ({ page }) => {
    await stubSheet(page)
    await page.goto('/')

    await page.getByRole('button', { name: /generate draft sheet/i }).click()

    const board = page.locator('main')
    // Player names also appear in the RECOMMENDED sidebar (a <ul>), so scope
    // board-table assertions to the table itself.
    const table = board.locator('table')
    // Top RB on the default (ALL) view.
    await expect(table.getByText('Christian McCaffrey')).toBeVisible()

    // Switching to the QB tab shows QBs. The tab's accessible name includes
    // its remaining-player count (e.g. "QB 2"), so match loosely.
    await board.getByRole('button', { name: /QB/ }).first().click()
    await expect(table.getByText('Josh Allen')).toBeVisible()
    await expect(table.getByText('Patrick Mahomes')).toBeVisible()
  })

  test('clicking a player marks them drafted', async ({ page }) => {
    await stubSheet(page)
    await page.goto('/')
    await page.getByRole('button', { name: /generate draft sheet/i }).click()

    const board = page.locator('main')
    // Click the board-table row (the name is also in the RECOMMENDED sidebar).
    await board.locator('table').getByText('Christian McCaffrey').click()

    await expect(board.getByText(/1 drafted/)).toBeVisible()
  })
})
