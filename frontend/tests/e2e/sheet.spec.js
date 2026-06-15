import { test, expect } from '@playwright/test'
import { stubSheet } from './helpers'

test.describe('sheet generation', () => {
  test('generates a board and renders players across positions', async ({ page }) => {
    await stubSheet(page)
    await page.goto('/')

    await page.getByRole('button', { name: /generate draft sheet/i }).click()

    const board = page.locator('main')
    // Top RB on the default (ALL) view.
    await expect(board.getByText('Christian McCaffrey')).toBeVisible()

    // Switching to the QB tab shows QBs. The tab's accessible name includes
    // its remaining-player count (e.g. "QB 2"), so match loosely.
    await board.getByRole('button', { name: /QB/ }).first().click()
    await expect(board.getByText('Josh Allen')).toBeVisible()
    await expect(board.getByText('Patrick Mahomes')).toBeVisible()
  })

  test('clicking a player marks them drafted', async ({ page }) => {
    await stubSheet(page)
    await page.goto('/')
    await page.getByRole('button', { name: /generate draft sheet/i }).click()

    const board = page.locator('main')
    await board.getByText('Christian McCaffrey').click()

    await expect(board.getByText(/1 drafted/)).toBeVisible()
  })
})
