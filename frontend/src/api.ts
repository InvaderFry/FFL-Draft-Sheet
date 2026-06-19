/**
 * Backend calls for ESPN draft sync, shared by the live-poll hook
 * (useEspnDraftSync) and the connect form's pre-flight check (DraftSync) so
 * the request shape lives in exactly one place.
 */

import type {
  ConnectionResult,
  DraftSettings,
  EspnDraftBody,
  SleeperDraftBody,
} from './types/api'

const API_URL = import.meta.env.VITE_API_URL || ''

/** The POST body for /api/draft/espn from a connect-form settings object. */
export function espnDraftBody(settings: DraftSettings): EspnDraftBody {
  return {
    league_id: Number(settings.leagueId),
    season: Number(settings.season),
    espn_s2: settings.espn_s2 || null,
    swid: settings.swid || null,
    mock_ingest: Boolean(settings.mock),
  }
}

/**
 * One-shot pre-flight against the live endpoint. Returns
 * { ok, status, detail } so the form can tell the user their league is
 * reachable (or their cookies are stale) BEFORE the draft starts, instead of
 * discovering it on the first mid-draft poll. Network failures surface as
 * status 0.
 */
export async function testEspnConnection(settings: DraftSettings): Promise<ConnectionResult> {
  try {
    const resp = await fetch(`${API_URL}/api/draft/espn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(espnDraftBody(settings)),
    })
    let detail = ''
    try {
      const data = await resp.json()
      if (typeof data?.detail === 'string') detail = data.detail
    } catch { /* non-JSON body — leave detail blank */ }
    return { ok: resp.ok, status: resp.status, detail }
  } catch {
    return { ok: false, status: 0, detail: 'Could not reach the sheet backend.' }
  }
}

/** The POST body for /api/draft/sleeper from a connect-form settings object. */
export function sleeperDraftBody(settings: DraftSettings): SleeperDraftBody {
  return { draft_id: String(settings.draftId || '').trim() }
}

/**
 * One-shot pre-flight against the live Sleeper endpoint, mirroring
 * testEspnConnection. Sleeper drafts are public (no credentials), so this only
 * confirms the draft ID is reachable BEFORE the draft starts. Returns
 * { ok, status, detail }; network failures surface as status 0.
 */
export async function testSleeperConnection(settings: DraftSettings): Promise<ConnectionResult> {
  try {
    const resp = await fetch(`${API_URL}/api/draft/sleeper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sleeperDraftBody(settings)),
    })
    let detail = ''
    try {
      const data = await resp.json()
      if (typeof data?.detail === 'string') detail = data.detail
    } catch { /* non-JSON body — leave detail blank */ }
    return { ok: resp.ok, status: resp.status, detail }
  } catch {
    return { ok: false, status: 0, detail: 'Could not reach the sheet backend.' }
  }
}
