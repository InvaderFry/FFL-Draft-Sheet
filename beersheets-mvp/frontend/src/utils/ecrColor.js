/**
 * U13 — ECR color utility
 *
 * Returns the CSS variable name (or class) to use for a player's ECR column
 * based on how far their ADP diverges from their rank.
 *
 * Rules (matching beersheet_clone.R):
 *   adp ≤ ecr_rank − n_teams  → "blue"   (ADP is earlier = going earlier than rank)
 *   adp ≥ ecr_rank + n_teams  → "orange" (ADP is later  = going later than rank)
 *   otherwise                  → "none"
 */

/**
 * @param {number|null} adpRank   - ADP pick number
 * @param {number|null} ecrRank   - ECR / rank pick number
 * @param {number}      nTeams    - league team count
 * @returns {'blue' | 'orange' | 'none'}
 */
export function ecrColor(adpRank, ecrRank, nTeams) {
  if (adpRank == null || ecrRank == null) return 'none'
  if (adpRank <= ecrRank - nTeams) return 'blue'
  if (adpRank >= ecrRank + nTeams) return 'orange'
  return 'none'
}

/**
 * Returns the inline style color string for the ECR cell.
 * @param {'blue'|'orange'|'none'} color
 * @returns {string} CSS color value
 */
export function ecrColorStyle(color) {
  switch (color) {
    case 'blue':   return 'var(--c-ecr-blue)'
    case 'orange': return 'var(--c-ecr-orange)'
    default:       return 'inherit'
  }
}
