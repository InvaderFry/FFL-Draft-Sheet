"""
U3 — Projection scraper.

Pulls raw per-stat projections for QB/RB/WR/TE/DST from multiple public
sites, normalises to a tidy list of StatRow dicts, and applies the league's
scoring to produce fantasy-point totals per (source, player).

Adapters:
  ESPN, CBS, FantasyPros, FFToday, NumberFire, FantasySharks
  (add more by implementing the adapter interface below)

Each adapter:
  - Is async (httpx.AsyncClient)
  - Returns List[dict] with keys: source, player_name, pos, team, sleeper_id, **stats
  - Sleeps 2s between page fetches (rate-limit courtesy)
  - On any error: logs warning, returns []  (caller tolerates missing sources)

The scraper reads/writes a per-source × per-position × per-date file cache so
live sites are only hit once per TTL window.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app import cache
from app.config import LeagueConfig, ScoringConfig
from app.data.players import find_player, PlayerRecord
from app.engine.scoring import score

logger = logging.getLogger(__name__)

_SLEEP = 2.0  # seconds between page fetches per site


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #

def _cache_key(source: str, pos: str) -> str:
    from datetime import date
    return f"proj_{source}_{pos}_{date.today()}"


def _attach_sleeper_id(rows: list[dict]) -> list[dict]:
    """Best-effort: look up each row's Sleeper ID by name+pos+team."""
    for row in rows:
        if row.get("sleeper_id"):
            continue
        rec: PlayerRecord | None = find_player(
            row.get("player_name", ""),
            row.get("pos", ""),
            row.get("team", ""),
        )
        if rec:
            row["sleeper_id"] = rec.sleeper_id
            if not row.get("espn_id") and rec.espn_id:
                row["espn_id"] = rec.espn_id
        else:
            row["sleeper_id"] = None
            logger.debug("No Sleeper ID match: %s %s %s", row.get("player_name"), row.get("pos"), row.get("team"))
    return rows


# --------------------------------------------------------------------------- #
# ESPN adapter
# --------------------------------------------------------------------------- #

ESPN_POS_MAP = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "DST": "DST"}
ESPN_SLOT_MAP = {"QB": 0, "RB": 2, "WR": 4, "TE": 6, "DST": 16}

async def _fetch_espn(client: httpx.AsyncClient, pos: str, cfg: LeagueConfig) -> list[dict]:
    slot = ESPN_SLOT_MAP.get(pos)
    if slot is None:
        return []
    season = cfg.season
    base_url = (
        f"https://fantasy.espn.com/apis/v3/games/ffl/seasons/{season}"
        f"/segments/0/leaguedefaults/3"
    )
    results = []
    limit, offset = 40, 0
    try:
        while True:
            params = {
                "view": "kona_player_info",
                "scoringPeriodId": 0,
                "slotCategoryId": slot,
                "limit": limit,
                "offset": offset,
            }
            headers = {"x-fantasy-filter": f'{{"players":{{"filterSlotIds":{{"value":[{slot}]}},"limit":{limit},"offset":{offset},"filterStatsForTopScorersScoringPeriodId":{{"value":0}},"sortPercOwned":{{"sortAsc":false,"sortPriority":1}}}}}}'}
            resp = await client.get(base_url, params=params, headers=headers, timeout=15)
            if resp.status_code != 200:
                break
            data = resp.json()
            players_data = data.get("players", [])
            if not players_data:
                break
            for p in players_data:
                pi = p.get("playerPoolEntry", {}).get("player", {})
                name = pi.get("fullName", "")
                stats_list = pi.get("stats", [])
                raw_stats: dict[str, float] = {}
                for s in stats_list:
                    if s.get("scoringPeriodId") == 0 and s.get("seasonId") == season:
                        raw_stats = {str(k): v for k, v in s.get("stats", {}).items()}
                        break
                # ESPN stat ID mapping (simplified)
                mapped = _map_espn_stats(raw_stats)
                if pos == "TE":
                    mapped["te_premium_eligible"] = True
                pts = score(mapped, cfg.scoring)
                results.append({
                    "source": "ESPN",
                    "player_name": name,
                    "pos": pos,
                    "team": "",
                    "sleeper_id": None,
                    "espn_id": str(pi.get("id", "")),
                    "points": pts,
                    **mapped,
                })
            offset += limit
            if len(players_data) < limit:
                break
            await asyncio.sleep(_SLEEP)
    except Exception as exc:
        logger.warning("ESPN scrape failed for %s: %s", pos, exc)
    return results


def _map_espn_stats(raw: dict[str, str]) -> dict:
    """Map ESPN stat IDs to our canonical stat keys (2026 season)."""
    # ESPN stat IDs (these are stable across seasons for common stats)
    ID_MAP = {
        "3": "pass_yds",   # passing yards
        "4": "pass_td",    # passing TDs
        "20": "interception",
        "24": "rush_yds",
        "25": "rush_td",
        "53": "rec",
        "42": "rec_yds",
        "43": "rec_td",
        "72": "fumble_lost",
        # DST
        "99": "dst_sack",
        "97": "dst_int",
        "96": "dst_fumble_rec",
        "98": "dst_safety",
        "95": "dst_td",
        "89": "dst_pa",
    }
    mapped: dict[str, float] = {}
    for eid, ckey in ID_MAP.items():
        if eid in raw:
            try:
                mapped[ckey] = float(raw[eid])
            except (ValueError, TypeError):
                pass
    return mapped


# --------------------------------------------------------------------------- #
# FantasyPros HTML adapter (free consensus projections)
# --------------------------------------------------------------------------- #

FP_POS_URLS = {
    "QB":  "https://www.fantasypros.com/nfl/projections/qb.php?week=draft&scoring=HALF",
    "RB":  "https://www.fantasypros.com/nfl/projections/rb.php?week=draft&scoring=HALF",
    "WR":  "https://www.fantasypros.com/nfl/projections/wr.php?week=draft&scoring=HALF",
    "TE":  "https://www.fantasypros.com/nfl/projections/te.php?week=draft&scoring=HALF",
    "DST": "https://www.fantasypros.com/nfl/projections/dst.php?week=draft",
}

async def _fetch_fantasypros(client: httpx.AsyncClient, pos: str, cfg: LeagueConfig) -> list[dict]:
    url = FP_POS_URLS.get(pos)
    if not url:
        return []
    try:
        resp = await client.get(url, timeout=20)
        resp.raise_for_status()
        return _parse_fantasypros_html(resp.text, pos, cfg.scoring)
    except Exception as exc:
        logger.warning("FantasyPros scrape failed for %s: %s", pos, exc)
        return []


def _parse_fantasypros_html(html: str, pos: str, cfg: ScoringConfig) -> list[dict]:
    """Parse FantasyPros projection table (HTML)."""
    try:
        from selectolax.parser import HTMLParser
    except ImportError:
        logger.warning("selectolax not installed, skipping FantasyPros parse")
        return []

    tree = HTMLParser(html)
    results = []

    table = tree.css_first("table#data")
    if not table:
        return []

    rows = table.css("tbody tr")
    for row in rows:
        cells = [td.text(strip=True) for td in row.css("td")]
        if len(cells) < 6:
            continue
        # Column layout differs slightly by position
        try:
            if pos == "QB":
                # Name, Team, Cmp, Att, Yds, TDs, Ints, Rush Att, Rush Yds, Rush TDs, FL, Pts
                name_team = cells[0]
                name, team = _split_fp_name_team(name_team)
                stats = {
                    "pass_yds": _f(cells[3]),
                    "pass_td":  _f(cells[4]),
                    "interception": _f(cells[5]),
                    "rush_yds": _f(cells[7]),
                    "rush_td":  _f(cells[8]),
                    "fumble_lost": _f(cells[9]),
                }
            elif pos in ("RB",):
                name_team = cells[0]
                name, team = _split_fp_name_team(name_team)
                stats = {
                    "rush_yds": _f(cells[2]),
                    "rush_td":  _f(cells[3]),
                    "rec":      _f(cells[4]),
                    "rec_yds":  _f(cells[5]),
                    "rec_td":   _f(cells[6]),
                    "fumble_lost": _f(cells[7]),
                }
            elif pos in ("WR", "TE"):
                name_team = cells[0]
                name, team = _split_fp_name_team(name_team)
                stats = {
                    "rec":      _f(cells[2]),
                    "rec_yds":  _f(cells[3]),
                    "rec_td":   _f(cells[4]),
                    "rush_yds": _f(cells[5]) if len(cells) > 7 else 0,
                    "rush_td":  _f(cells[6]) if len(cells) > 8 else 0,
                    "fumble_lost": _f(cells[-2]),
                }
                if pos == "TE":
                    stats["te_premium_eligible"] = True
            elif pos == "DST":
                name = cells[0].split(" ")[0] + " D/ST"
                team = cells[0].split(" ")[0]
                stats = {
                    "dst_sack":       _f(cells[1]),
                    "dst_int":        _f(cells[2]),
                    "dst_fumble_rec": _f(cells[3]),
                    "dst_safety":     _f(cells[4]),
                    "dst_td":         _f(cells[5]),
                    "dst_pa":         _f(cells[6]),
                }
            else:
                continue

            pts = score(stats, cfg)
            results.append({
                "source": "FantasyPros",
                "player_name": name,
                "pos": pos,
                "team": team,
                "sleeper_id": None,
                "points": pts,
                **stats,
            })
        except (IndexError, ValueError):
            continue
    return results


def _split_fp_name_team(text: str) -> tuple[str, str]:
    """'Patrick Mahomes KC' → ('Patrick Mahomes', 'KC')"""
    parts = text.rsplit(" ", 1)
    if len(parts) == 2 and len(parts[1]) <= 3 and parts[1].isupper():
        return parts[0], parts[1]
    return text, ""


def _f(s: str) -> float:
    try:
        return float(s.replace(",", ""))
    except (ValueError, TypeError):
        return 0.0


# --------------------------------------------------------------------------- #
# FFToday adapter
# --------------------------------------------------------------------------- #

FFTODAY_POS_MAP = {"QB": 10, "RB": 20, "WR": 30, "TE": 40}
FFTODAY_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; BeerSheetsBot/1.0)"
}

async def _fetch_fftoday(client: httpx.AsyncClient, pos: str, cfg: LeagueConfig) -> list[dict]:
    pos_id = FFTODAY_POS_MAP.get(pos)
    if pos_id is None:
        return []
    url = f"https://www.fftoday.com/rankings/playerproj.php?Season={cfg.season}&PosID={pos_id}&LeagueID=1"
    try:
        resp = await client.get(url, headers=FFTODAY_HEADERS, timeout=20)
        resp.raise_for_status()
        return _parse_fftoday_html(resp.text, pos, cfg.scoring)
    except Exception as exc:
        logger.warning("FFToday scrape failed for %s: %s", pos, exc)
        return []


def _parse_fftoday_html(html: str, pos: str, cfg: ScoringConfig) -> list[dict]:
    try:
        from selectolax.parser import HTMLParser
    except ImportError:
        return []

    tree = HTMLParser(html)
    results = []
    rows = tree.css("tr.tablehdr + tr, tr.tablehdr ~ tr")
    for row in rows:
        cells = [td.text(strip=True) for td in row.css("td")]
        if len(cells) < 5 or not cells[0]:
            continue
        try:
            name = cells[0]
            team = cells[1] if len(cells) > 1 else ""
            if pos == "QB":
                stats = {"pass_yds": _f(cells[4]), "pass_td": _f(cells[5]), "interception": _f(cells[6]),
                         "rush_yds": _f(cells[8]), "rush_td": _f(cells[9])}
            elif pos == "RB":
                stats = {"rush_yds": _f(cells[3]), "rush_td": _f(cells[4]),
                         "rec": _f(cells[5]), "rec_yds": _f(cells[6]), "rec_td": _f(cells[7])}
            elif pos in ("WR", "TE"):
                stats = {"rec": _f(cells[3]), "rec_yds": _f(cells[4]), "rec_td": _f(cells[5])}
                if pos == "TE":
                    stats["te_premium_eligible"] = True
            else:
                continue
            pts = score(stats, cfg)
            results.append({"source": "FFToday", "player_name": name, "pos": pos,
                             "team": team, "sleeper_id": None, "points": pts, **stats})
        except (IndexError, ValueError):
            continue
    return results


# --------------------------------------------------------------------------- #
# NumberFire adapter (JSON API)
# --------------------------------------------------------------------------- #

NF_POS_MAP = {"QB": "qb", "RB": "rb", "WR": "wr", "TE": "te", "DST": "dst"}

async def _fetch_numberfire(client: httpx.AsyncClient, pos: str, cfg: LeagueConfig) -> list[dict]:
    nf_pos = NF_POS_MAP.get(pos)
    if not nf_pos:
        return []
    url = f"https://www.numberfire.com/nfl/fantasy/fantasy-football-projections/{nf_pos}"
    try:
        resp = await client.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        return _parse_numberfire_html(resp.text, pos, cfg.scoring)
    except Exception as exc:
        logger.warning("NumberFire scrape failed for %s: %s", pos, exc)
        return []


def _parse_numberfire_html(html: str, pos: str, cfg: ScoringConfig) -> list[dict]:
    try:
        from selectolax.parser import HTMLParser
    except ImportError:
        return []
    tree = HTMLParser(html)
    results = []
    rows = tree.css("table.projection-table tbody tr")
    for row in rows:
        cells = [td.text(strip=True) for td in row.css("td")]
        if len(cells) < 4:
            continue
        try:
            name_el = row.css_first("a.full-name")
            name = name_el.text(strip=True) if name_el else cells[0]
            team_el = row.css_first("span.player-info--team")
            team = team_el.text(strip=True) if team_el else ""
            if pos == "QB":
                stats = {"pass_yds": _f(cells[2]), "pass_td": _f(cells[4]),
                         "interception": _f(cells[5]), "rush_yds": _f(cells[6]), "rush_td": _f(cells[7])}
            elif pos == "RB":
                stats = {"rush_yds": _f(cells[1]), "rush_td": _f(cells[2]),
                         "rec": _f(cells[3]), "rec_yds": _f(cells[4]), "rec_td": _f(cells[5])}
            elif pos in ("WR", "TE"):
                stats = {"rec": _f(cells[1]), "rec_yds": _f(cells[2]), "rec_td": _f(cells[3])}
                if pos == "TE":
                    stats["te_premium_eligible"] = True
            else:
                continue
            pts = score(stats, cfg)
            results.append({"source": "NumberFire", "player_name": name, "pos": pos,
                             "team": team, "sleeper_id": None, "points": pts, **stats})
        except (IndexError, ValueError):
            continue
    return results


# --------------------------------------------------------------------------- #
# Main orchestration
# --------------------------------------------------------------------------- #

ADAPTERS = {
    "FantasyPros": _fetch_fantasypros,
    "FFToday":     _fetch_fftoday,
    "NumberFire":  _fetch_numberfire,
    "ESPN":        _fetch_espn,
}

POSITIONS = ["QB", "RB", "WR", "TE", "DST"]


async def scrape_position(pos: str, cfg: LeagueConfig, sources: list[str] | None = None) -> list[dict]:
    """
    Scrape all sources for a given position.  Returns a list of:
        {"source", "player_name", "pos", "team", "sleeper_id", "points", **raw_stats}
    Missing sources are silently dropped.
    """
    sources = sources or list(ADAPTERS.keys())
    all_rows: list[dict] = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for src_name in sources:
            fn = ADAPTERS.get(src_name)
            if fn is None:
                continue

            ck = _cache_key(src_name, pos)
            cached = cache.get(ck)
            if cached is not None:
                logger.info("Projection cache hit: %s %s (%d rows)", src_name, pos, len(cached))
                all_rows.extend(cached)
                continue

            logger.info("Scraping %s %s…", src_name, pos)
            rows = await fn(client, pos, cfg)
            rows = _attach_sleeper_id(rows)
            if rows:
                cache.set(ck, rows)
                logger.info("  → %d rows", len(rows))
            else:
                logger.warning("  → 0 rows (source may be down)")
            all_rows.extend(rows)
            await asyncio.sleep(_SLEEP)

    return all_rows


async def scrape_all(cfg: LeagueConfig, sources: list[str] | None = None) -> dict[str, list[dict]]:
    """Scrape all positions concurrently (one position per task)."""
    tasks = {pos: asyncio.create_task(scrape_position(pos, cfg, sources)) for pos in POSITIONS}
    results: dict[str, list[dict]] = {}
    for pos, task in tasks.items():
        try:
            results[pos] = await task
        except Exception as exc:
            logger.error("Scrape task failed for %s: %s", pos, exc)
            results[pos] = []
    return results
