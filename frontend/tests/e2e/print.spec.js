import { test, expect } from '@playwright/test'
import { stubSheet } from './helpers'

test.describe('print layout', () => {
  test('print view becomes visible under print media with the players on it', async ({ page }) => {
    await stubSheet(page)
    await page.goto('/')
    await page.getByRole('button', { name: /generate draft sheet/i }).click()
    await expect(page.locator('main').getByText('Christian McCaffrey')).toBeVisible()

    // The one-page print sheet is hidden on screen and revealed for print.
    const printSheet = page.locator('.print-sheet')
    await expect(printSheet).toBeHidden()

    await page.emulateMedia({ media: 'print' })
    await expect(printSheet).toBeVisible()
    await expect(printSheet.getByText('Christian McCaffrey')).toBeVisible()

    await page.screenshot({ path: 'test-results/print-sheet.png', fullPage: true })
  })
})
