"""
U9 — Positional scarcity and auction dollar conversion.

Positional scarcity (PS%):
    ps[i] = (total_positive_val − cumsum[i]) / total_positive_val
    → share of total positive positional value remaining AFTER this player.
    Lower PS% = grab him now (more urgent).
    The last player in the position has PS% ≈ 0%.

Auction dollars (R8):
    discretionary = n_teams × budget − n_rostered × $1
    dollars_per_pt = discretionary / sum_of_all_pos_val
    price[i] = $1 + val[i] × dollars_per_pt      (clamped to ≥ $1)
"""

from __future__ import annotations

import logging

from app.config import LeagueConfig
from app.engine.vbd import PlayerVBD

logger = logging.getLogger(__name__)


def assign_positional_scarcity(players: list[PlayerVBD]) -> list[PlayerVBD]:
    """
    Compute ps_pct for each player.  Mutates in place.
    Assumes `players` is sorted descending by VAL (pos_rank order).
    """
    vals = [max(p.val, 0.0) for p in players]
    total = sum(vals)
    if total == 0:
        for p in players:
            p.ps_pct = 0.0
        return players

    cumulative = 0.0
    for p, v in zip(players, vals):
        cumulative += v
        remaining = total - cumulative
        p.ps_pct = max(0.0, remaining / total)

    return players


def assign_auction_prices(
    all_players: list[PlayerVBD],
    cfg: LeagueConfig,
) -> list[PlayerVBD]:
    """
    Compute auction dollar values across ALL positions combined.

    Parameters
    ----------
    all_players : list[PlayerVBD]
        Every position's players concatenated.
    cfg : LeagueConfig
        Must have auction_mode=True for this to be meaningful.

    Returns
    -------
    The same list with auction_price populated.
    """
    if not cfg.auction_mode:
        return all_players

    discretionary = cfg.n_teams * cfg.auction_budget - cfg.n_rostered * 1
    if discretionary <= 0:
        logger.warning("Auction discretionary pool ≤ 0 — check n_rostered and budget")
        for p in all_players:
            p.auction_price = 1.0
        return all_players

    total_val = sum(max(p.val, 0.0) for p in all_players)
    if total_val == 0:
        for p in all_players:
            p.auction_price = 1.0
        return all_players

    dpp = discretionary / total_val  # dollars per VBD point

    for p in all_players:
        raw = 1.0 + max(p.val, 0.0) * dpp
        p.auction_price = max(1.0, round(raw, 0))

    logger.info(
        "Auction prices: discretionary=$%d, total_val=%.1f, $/pt=%.3f",
        discretionary, total_val, dpp,
    )
    return all_players
