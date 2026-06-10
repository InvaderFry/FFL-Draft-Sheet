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
  - On any error: raises exception (caught by scrape_position, which records a SourceOutcome)

The scraper reads/writes a per-source × per-position × per-date file cache so
live sites are only hit once per TTL window.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass

import httpx

from app import cache
from app.config import LeagueConfig, ScoringConfig
from app.data.players import find_player, PlayerRecord
from app.engine.scoring import score

logger = logging.getLogger(__name__)

_SLEEP = 2.0  # seconds between page fetches per site


@dataclass(frozen=True)
class SourceOutcome:
    source: str
    position: str
    rows: int
    reason: str | None = None


class ScrapeRows(list):
    """List of projection rows with per-source outcomes attached."""

    def __init__(self, rows: list[dict] | None = None, outcomes: list[SourceOutcome] | None = None):
        super().__init__(rows or [])
        self.outcomes = outcomes or []


class ScrapeResult(dict):
    """Position-keyed projection rows with all per-position source outcomes."""

    def __init__(
        self,
        rows_by_position: dict[str, list[dict]] | None = None,
        outcomes: list[SourceOutcome] | None = None,
    ):
        super().__init__(rows_by_position or {})
        self.outcomes = outcomes or []


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


def _sanitize_failure_reason(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
        return "timeout"
    if isinstance(exc, httpx.RequestError):
        return "fetch error"
    return "parse error"


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
    while True:
        params = {
            "view": "kona_player_info",
            # scoringPeriodId=0 asks ESPN for season-long projections; before
            # July those values can be placeholders or otherwise unreliable.
            "scoringPeriodId": 0,
            "slotCategoryId": slot,
            "limit": limit,
            "offset": offset,
        }
        headers = {"x-fantasy-filter": f'{{"players":{{"filterSlotIds":{{"value":[{slot}]}},"limit":{limit},"offset":{offset},"filterStatsForTopScorersScoringPeriodId":{{"value":0}},"sortPercOwned":{{"sortAsc":false,"sortPriority":1}}}}}}'}
        resp = await client.get(base_url, params=params, headers=headers, timeout=15)
        if resp.status_code != 200:
            logger.warning("ESPN returned %s for %s offset %s; stopping pagination", resp.status_code, pos, offset)
            break
        try:
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
        except Exception as exc:
            logger.warning("ESPN parse error for %s at offset %s: %s", pos, offset, exc)
            break
        await asyncio.sleep(_SLEEP)
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
    resp = await client.get(url, timeout=20)
    resp.raise_for_status()
    return _parse_fantasypros_html(resp.text, pos, cfg.scoring)


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
        td_nodes = row.css("td")
        cells = [td.text(strip=True) for td in td_nodes]
        if len(cells) < 6:
            continue
        # Column layout differs slightly by position
        try:
            if pos == "DST":
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
                # Extract name from <a> element and team from the sibling text.
                # selectolax.text() concatenates adjacent inline elements without
                # spaces ("Josh AllenBUF"), so we target elements explicitly like
                # the NumberFire adapter does instead of splitting concatenated text.
                first_td = td_nodes[0]
                name_el = first_td.css_first("a")
                if name_el:
                    name = name_el.text(strip=True)
                    full = cells[0]
                    rest = full[len(name):].strip() if full.startswith(name) else ""
                    team_word = rest.split()[0] if rest else ""
                    if 2 <= len(team_word) <= 3 and team_word.isupper():
                        team = team_word
                    else:
                        # Anchor may only wrap a partial name; try to extract a
                        # validated team code from the full cell text. Only replace
                        # `name` when the fallback actually found a team — if it
                        # couldn't, keep the anchor-extracted fragment rather than
                        # overwriting it with raw concatenated cell text.
                        corrected_name, team = _split_fp_name_team(full)
                        if team:
                            name = corrected_name
                else:
                    name, team = _split_fp_name_team(cells[0])

                if pos == "QB":
                    # Name, Team, Cmp, Att, Yds, TDs, Ints, Rush Att, Rush Yds, Rush TDs, FL, Pts
                    stats = {
                        "pass_yds": _f(cells[3]),
                        "pass_td":  _f(cells[4]),
                        "interception": _f(cells[5]),
                        "rush_yds": _f(cells[7]),
                        "rush_td":  _f(cells[8]),
                        "fumble_lost": _f(cells[9]),
                    }
                elif pos in ("RB",):
                    stats = {
                        "rush_yds": _f(cells[2]),
                        "rush_td":  _f(cells[3]),
                        "rec":      _f(cells[4]),
                        "rec_yds":  _f(cells[5]),
                        "rec_td":   _f(cells[6]),
                        "fumble_lost": _f(cells[7]),
                    }
                elif pos in ("WR", "TE"):
                    stats = {
                        "rec":      _f(cells[2]),
                        "rec_yds":  _f(cells[3]),
                        "rec_td":   _f(cells[4]),
                        "rush_yds": _f(cells[5]) if len(cells) > 7 else 0,
                        "rush_td":  _f(cells[6]) if len(cells) > 8 else 0,
                        # cells[-2] is fumble_lost when len>=9: FP puts [rush_td, fumble, pts]
                        # at the tail; guard matches rush_td so both columns arrive together.
                        "fumble_lost": _f(cells[-2]) if len(cells) > 8 else 0,
                    }
                    if pos == "TE":
                        stats["te_premium_eligible"] = True
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


_TEAM_RE = re.compile(r'([A-Z]{2,3})$')

_NFL_TEAMS = frozenset({
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
    "DAL", "DEN", "DET", "GB",  "HOU", "IND", "JAC", "KC",
    "LA",  "LAC", "LV",  "MIA", "MIN", "NE",  "NO",  "NYG",
    "NYJ", "PHI", "PIT", "SEA", "SF",  "TB",  "TEN", "WAS",
})


def _split_fp_name_team(text: str) -> tuple[str, str]:
    """'Patrick Mahomes KC' or 'Patrick MahomesKC' → ('Patrick Mahomes', 'KC')"""
    # Space-separated: "Patrick Mahomes KC"
    parts = text.rsplit(" ", 1)
    if len(parts) == 2 and len(parts[1]) <= 3 and parts[1].isupper() and parts[1] in _NFL_TEAMS:
        return parts[0], parts[1]
    # Concatenated (selectolax omits spaces between inline elements): "Josh AllenBUF".
    # Validate against known NFL team codes to avoid misidentifying name suffixes.
    m = _TEAM_RE.search(text)
    if m:
        team = m.group(1)
        if team in _NFL_TEAMS:
            name = text[:-len(team)].rstrip()
            if name:
                return name, team
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
    resp = await client.get(url, headers=FFTODAY_HEADERS, timeout=20)
    resp.raise_for_status()
    return _parse_fftoday_html(resp.text, pos, cfg.scoring)


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
    resp = await client.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    return _parse_numberfire_html(resp.text, pos, cfg.scoring)


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

SOURCE_POSITION_SUPPORT = {
    "FantasyPros": set(FP_POS_URLS),
    "FFToday": set(FFTODAY_POS_MAP),
    "NumberFire": set(NF_POS_MAP),
    "ESPN": set(ESPN_SLOT_MAP),
}


async def scrape_position(pos: str, cfg: LeagueConfig, sources: list[str] | None = None) -> ScrapeRows:
    """
    Scrape all sources for a given position.  Returns a list of:
        {"source", "player_name", "pos", "team", "sleeper_id", "points", **raw_stats}
    Missing sources are dropped from rows and recorded in `rows.outcomes`.
    """
    sources = sources or list(ADAPTERS.keys())
    all_rows: list[dict] = []
    outcomes: list[SourceOutcome] = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for src_name in sources:
            fn = ADAPTERS.get(src_name)
            if fn is None:
                outcomes.append(SourceOutcome(src_name, pos, 0, "unsupported"))
                continue

            if pos not in SOURCE_POSITION_SUPPORT.get(src_name, set(POSITIONS)):
                outcomes.append(SourceOutcome(src_name, pos, 0, "unsupported"))
                continue

            ck = _cache_key(src_name, pos)
            cached = cache.get(ck)
            if cached is not None:
                logger.info("Projection cache hit: %s %s (%d rows)", src_name, pos, len(cached))
                all_rows.extend(cached)
                outcomes.append(SourceOutcome(src_name, pos, len(cached), None if cached else "0 rows"))
                continue

            logger.info("Scraping %s %s…", src_name, pos)
            try:
                rows = await fn(client, pos, cfg)
                rows = _attach_sleeper_id(rows)
            except Exception as exc:
                reason = _sanitize_failure_reason(exc)
                logger.warning("%s scrape failed for %s: %s", src_name, pos, reason)
                outcomes.append(SourceOutcome(src_name, pos, 0, reason))
                await asyncio.sleep(_SLEEP)
                continue

            if rows:
                cache.set(ck, rows)
                logger.info("  → %d rows", len(rows))
                outcomes.append(SourceOutcome(src_name, pos, len(rows), None))
            else:
                logger.warning("  → 0 rows (source may be down)")
                outcomes.append(SourceOutcome(src_name, pos, 0, "0 rows"))
            all_rows.extend(rows)
            await asyncio.sleep(_SLEEP)

    return ScrapeRows(all_rows, outcomes=outcomes)


async def scrape_all(cfg: LeagueConfig, sources: list[str] | None = None) -> ScrapeResult:
    """Scrape all positions concurrently (one position per task)."""
    tasks = {pos: asyncio.create_task(scrape_position(pos, cfg, sources)) for pos in POSITIONS}
    results: dict[str, list[dict]] = {}
    outcomes: list[SourceOutcome] = []
    for pos, task in tasks.items():
        try:
            rows = await task
            results[pos] = list(rows)
            outcomes.extend(rows.outcomes)
        except Exception as exc:
            logger.error("Scrape task failed for %s: %s", pos, exc)
            results[pos] = []
            for src in (sources or list(ADAPTERS)):
                outcomes.append(SourceOutcome(src, pos, 0, "task error"))
    return ScrapeResult(results, outcomes=outcomes)
