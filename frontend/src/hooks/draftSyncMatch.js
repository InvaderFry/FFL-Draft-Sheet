/**
 * Shared helpers for matching live draft picks onto sheet rows.
 *
 * Used by both useEspnDraftSync and useSleeperDraftSync. A synced pick must
 * cross off the same board row the user would have clicked; PlayerTable keys
 * rows by sleeper_id || player_name. The provider-specific id index (espn_id or
 * sleeper_id) is the primary match; matchByNamePos is the shared fallback for
 * picks whose id the sheet row is missing but that the backend named anyway.
 */

// Whether two team lists are value-equal, so the hook can skip a setState that
// would re-render the board with identical data every poll.
export function sameTeams(a, b) {
  return a.length === b.length &&
    a.every((t, i) => t.team_id === b[i].team_id && t.name === b[i].name)
}

// Sources spell names differently ("D.J. Moore" vs "DJ Moore Jr."), so the
// name-fallback index strips suffixes and punctuation before comparing.
export function normName(name) {
  return name.toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/, '')
    .replace(/[^a-z0-9]/g, '')
}

// Team codes are spelled differently across sources (sheet rows come from
// scraped projections, pick teams from Sleeper/ESPN) — canonicalize the
// known splits before comparing.
const TEAM_ALIASES = { JAX: 'JAC', WSH: 'WAS', LAR: 'LA' }
export function normTeam(team) {
  const t = (team || '').toUpperCase()
  return TEAM_ALIASES[t] || t
}

// Resolve a backend-named pick to a sheet row by name+pos. Sheet rows can
// share a name+pos key (the NFL has had duplicate names within a position),
// so only match when the candidate is unique — or when the pick's NFL team
// singles one out. An ambiguous key stays unmatched: a correctly-named
// off-sheet entry beats crossing off the wrong row.
export function matchByNamePos(byNamePos, pick) {
  if (!pick.player_name || !pick.pos) return undefined
  const candidates = byNamePos.get(`${normName(pick.player_name)}|${pick.pos.toUpperCase()}`)
  if (!candidates) return undefined
  if (candidates.length === 1) return candidates[0]
  if (!pick.nfl_team) return undefined
  const sameTeam = candidates.filter(c => normTeam(c.team) === normTeam(pick.nfl_team))
  return sameTeam.length === 1 ? sameTeam[0] : undefined
}
