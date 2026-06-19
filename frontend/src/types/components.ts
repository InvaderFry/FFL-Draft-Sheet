/**
 * Shared prop types for the React components.
 *
 * The player tables (PlayerTable, CombinedView) and the board that hosts them
 * pass a large common bundle of display/interaction props, captured once here
 * as TableViewProps. The sync-hook return shapes are derived from the hooks
 * themselves so DraftSync/DraftBoard can't drift from what the hooks expose.
 */

import type { useEspnDraftSync } from '../hooks/useEspnDraftSync'
import type { useSleeperDraftSync } from '../hooks/useSleeperDraftSync'
import type { ManualTiers } from './domain'

/** The two pick numbers the per-row survival marker needs. */
export interface TableStrategy {
  currentPick: number | null
  nextPick: number | null
}

/** Cross a player off the board: (id, name, pos). */
export type ToggleFn = (id: string, name: string, pos: string | null) => void

/** Display + interaction props shared by PlayerTable and CombinedView. */
export interface TableViewProps {
  nTeams: number
  isDrafted: (id: string) => boolean
  onToggle: ToggleFn
  auctionMode: boolean
  minVal?: number
  maxVal?: number
  strategy?: TableStrategy | null
  search?: string
  watchedOnly?: boolean
  isWatched?: (id: string) => boolean
  toggleWatch?: (id: string) => void
  shadeBy?: string
  linesBy?: string
  manualTiers?: ManualTiers | null
  manualEdit?: boolean
  onToggleBoundary?: (pos: string, id: string) => void
  thinMode?: boolean
}

export type EspnSyncApi = ReturnType<typeof useEspnDraftSync>
export type SleeperSyncApi = ReturnType<typeof useSleeperDraftSync>
export type SyncApi = EspnSyncApi | SleeperSyncApi
