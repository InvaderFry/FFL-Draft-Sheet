import { test, expect } from '@playwright/test'
import { stubSheet, stubDraft } from './helpers'

test.describe('live ESPN draft sync', () => {
  test('synced picks cross players off the board', async ({ page }) => {
    await stubSheet(page)
    await stubDraft(page)
    await page.goto('/')

    // Generate the sheet first so the sync hook can map picks onto its rows.
    await page.getByRole('button', { name: /generate draft sheet/i }).click()
    const board = page.locator('main')
    await expect(board.getByText('Christian McCaffrey')).toBeVisible()

    // Open the sync form, enter a league, and connect.
    await page.getByRole('button', { name: /sync espn draft/i }).click()
    await page.getByPlaceholder(/12345678/).fill('99887766')
    await page.getByRole('button', { name: /^Connect$/ }).click()

    // Both recorded picks are applied: the board reflects the drafted count
    // and the live-sync status chip reports the picks.
    await expect(board.getByText(/2 drafted/)).toBeVisible()
    await expect(page.getByText(/Draft complete · 2 picks/)).toBeVisible()
  })

  test('pre-flight test connection reports a reachable league', async ({ page }) => {
    await stubSheet(page)
    await stubDraft(page)
    await page.goto('/')
    await page.getByRole('button', { name: /generate draft sheet/i }).click()

    await page.getByRole('button', { name: /sync espn draft/i }).click()
    await page.getByPlaceholder(/12345678/).fill('99887766')
    await page.getByRole('button', { name: /test connection/i }).click()

    await expect(page.getByText(/League reachable/i)).toBeVisible()
  })
})
