import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** Load a recorded API response fixture as a parsed object. */
export function fixture(name) {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf-8'))
}

/**
 * Stub the sheet-generation endpoint with a recorded 12-team response so the
 * board renders deterministically without the live scraper.
 */
export async function stubSheet(page, body = fixture('sheet_12team.json')) {
  await page.route('**/api/sheet', route =>
    route.fulfill({ json: body })
  )
}

/** Stub the live ESPN draft endpoint with a recorded picks snapshot. */
export async function stubDraft(page, body = fixture('draft_ingest.json')) {
  await page.route('**/api/draft/espn', route =>
    route.fulfill({ json: body })
  )
}
