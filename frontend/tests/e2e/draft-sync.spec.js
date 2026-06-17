import { test, expect } from '@playwright/test'
import { stubSheet, stubDraft, fixture } from './helpers'

test.describe('live ESPN draft sync', () => {
  test('synced picks cross players off the board', async ({ page }) => {
    await stubSheet(page)
    await stubDraft(page)
    await page.goto('/')

    // Generate the sheet first so the sync hook can map picks onto its rows.
    await page.getByRole('button', { name: /generate draft sheet/i }).click()
    const board = page.locator('main')
    // Name also appears in the RECOMMENDED sidebar; scope to the board table.
    await expect(board.locator('table').getByText('Christian McCaffrey')).toBeVisible()

    // Open the sync form, enter a league, and connect.
    await page.getByRole('button', { name: /sync espn draft/i }).click()
    await page.getByPlaceholder(/12345678/).fill('99887766')
    await page.getByRole('button', { name: /^Connect$/ }).click()

    // Both recorded picks are applied: the board reflects the drafted count
    // and the live-sync status chip reports the picks.
    await expect(board.getByText(/2 drafted/)).toBeVisible()
    await expect(page.getByText(/Draft complete · 2 picks/)).toBeVisible()
  })

  test('strategy tools appear once a My Team is selected', async ({ page }) => {
    await stubSheet(page)
    // Snake-only strategy (next pick, runs, survival markers) shows for a LIVE
    // draft, not a completed one — stub an in-progress snapshot.
    await stubDraft(page, fixture('draft_in_progress.json'))
    await page.goto('/')
    await page.getByRole('button', { name: /generate draft sheet/i }).click()
    await page.getByRole('button', { name: /sync espn draft/i }).click()
    await page.getByPlaceholder(/12345678/).fill('99887766')
    await page.getByRole('button', { name: /^Connect$/ }).click()
    await expect(page.locator('main').getByText(/2 drafted/)).toBeVisible()

    // Pick the user's team (owns the McCaffrey pick at overall 1).
    await page.locator('select').filter({ hasText: 'Team Derrick' }).selectOption({ label: 'Team Derrick' })

    // Roster-needs chip, run alert, and next-pick line all render.
    await expect(page.getByText(/Your next pick:/)).toBeVisible()
    await expect(page.getByText('RB 1/2')).toBeVisible()
    await expect(page.getByText(/1 WR off the board/)).toBeVisible()
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
