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

/** The three divergence states an ECR cell can take. */
export type EcrColor = 'blue' | 'orange' | 'none'

/**
 * @param adpRank  ADP pick number
 * @param ecrRank  ECR / rank pick number
 * @param nTeams   league team count
 */
export function ecrColor(
  adpRank: number | null,
  ecrRank: number | null,
  nTeams: number,
): EcrColor {
  if (adpRank == null || ecrRank == null) return 'none'
  if (adpRank <= ecrRank - nTeams) return 'blue'
  if (adpRank >= ecrRank + nTeams) return 'orange'
  return 'none'
}

/** Returns the inline style color string for the ECR cell. */
export function ecrColorStyle(color: EcrColor): string {
  switch (color) {
    case 'blue':   return 'var(--c-ecr-blue)'
    case 'orange': return 'var(--c-ecr-orange)'
    default:       return 'inherit'
  }
}
