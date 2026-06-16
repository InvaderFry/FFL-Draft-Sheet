# 🍺 FFL Draft Sheet

**A free, league-customizable fantasy football draft cheat sheet** — the BeerSheets-style tool the r/fantasyfootball community has been missing since 2023.

Generates a Value-Based Drafting board with man-games baseline, switchable tier methods (Jenks / GMM / manual), ECR round|pick formatting, and a printable one-page layout — all from public data, no paid subscriptions required.

---

## Features

- **Value-Based Drafting (VBD)** with the Frank Dupont "man-games" replacement baseline
- **Floor / VAL / Ceiling** columns using historical weekly outcome variance, with source-σ fallback
- **Switchable tier methods** (12 tiers for RB/WR, 8 for QB/TE, 6 for DST):
  - **Jenks** natural breaks (default) and a **GMM** (Gaussian-mixture, Boris-Chen-style) method, both computed server-side
  - **Boris Chen** published tiers (scaffolded — lights up when a tier CSV is supplied)
  - **Manual** tiers you edit yourself, seeded from any method and saved per league
- **Dual-encoding tier display** — shade rows by one method *and* draw colored boundary lines for a second, to compare two tiering methods at a glance (the "Shade" / "Lines" selectors)
- **Positional scarcity (PS%)** — share of value remaining after each player
- **ECR** formatted as `round|pick` with ADP-divergence coloring (blue = going earlier, orange = later)
- **Auction dollar values** using the standard VBD-to-dollars formula
- **Click-to-cross-off** drafted players; state persists for the session
- **Live ESPN draft-room sync** — picks made in your ESPN draft are crossed off automatically, with team attribution and a "My Team" roster panel (private leagues supported via espn_s2/SWID cookies)
- **Printable one-pager** matching the classic BeerSheets landscape layout (`@media print`)
- All from **free public APIs** (Sleeper, Fantasy Football Calculator, public projection sites)

---

## Quick start (Docker Compose)

```bash
git clone https://github.com/InvaderFry/FFL-Draft-Sheet.git
cd FFL-Draft-Sheet
docker-compose up
```

Then open:
- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8000/docs

---

## Development setup (without Docker)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
PYTHONPATH=. uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Tests

Backend (pytest):

```bash
cd backend
PYTHONPATH=. pytest tests/ -v
```

Frontend (Vitest + Testing Library) and lint:

```bash
cd frontend
npm test        # unit + component tests (jsdom)
npm run lint    # eslint
```

---

## API

### `GET /health`

```json
{ "status": "ok", "version": "0.1.0" }
```

### `POST /api/sheet`

**Request body:**
```json
{
  "n_teams": 12,
  "fantasy_weeks": 14,
  "QB": 1, "RB": 2, "WR": 3, "TE": 1, "DST": 1, "K": 0,
  "flex_slots": 1,
  "bench_spots": 6,
  "flex_rb": 0.5, "flex_wr": 0.4, "flex_te": 0.1,
  "auction_mode": false,
  "auction_budget": 200,
  "scoring": { "rec": 0.5 }
}
```

**Response:** Player rows per position with `val`, `floor`, `ceil`, `ps_pct`, `ecr_fmt`, `tier`, `tier_is_even`, and `tiers` (a per-method map, e.g. `{"jenks": 3, "gmm": 4}`; `tier`/`tier_is_even` mirror the default Jenks method for back-compat). Manual tiers are not in the response — they live in the browser's `localStorage`, keyed per league.

> **Note:** `K` (kicker) is accepted in the request for forward-compatibility but is
> not yet scored — there is no kicker projection source wired in, so the response
> contains no `K` position block. See the Stage 2 roadmap.

Full schema auto-generated at `/docs`.

### `POST /api/draft/espn`

Live draft-room sync. A stateless proxy in front of ESPN's (undocumented) v3
fantasy API: fetches the league with `view=mDraftDetail&view=mTeams`,
normalizes picks, and enriches them with player names via the Sleeper map.
The frontend polls this every ~5s during a draft — ESPN is the source of
truth, so nothing is stored server-side. Notes on ESPN's API surface (and the
draft room's WebSocket feed) live in [docs/espn-draft-api.md](docs/espn-draft-api.md).

**Request body:**
```json
{
  "league_id": 12345678,
  "season": 2026,
  "espn_s2": "…",   // optional — private leagues only
  "swid": "{…}"     // optional — private leagues only
}
```

**Response:** `{provider, in_progress, complete, picks[], teams[], fetched_at}`
where each pick has `overall`, `round`, `team_id`, and bridged
`sleeper_id`/`player_name`/`pos` when known.

> **Security note:** `espn_s2`/`SWID` are cookies from espn.com that grant
> full access to your ESPN account. They are sent in the request body over
> HTTPS, forwarded to ESPN only, and never logged or cached by the backend.
> The frontend stores them only in your browser's localStorage ("Forget saved
> credentials" in the sync panel removes them).

---

## Setting up ESPN live draft sync

### Step 1 — Find your league ID

Open your league on [fantasy.espn.com](https://fantasy.espn.com) and look at
the URL:

```
https://fantasy.espn.com/football/league?leagueId=12345678
                                                  ^^^^^^^^
```

The number after `leagueId=` is what goes in the **League ID** field.

### Step 2 — Connect (public leagues)

If your league's settings allow public viewing, that's all you need:

1. Generate your sheet, then click **⚡ Sync ESPN draft** in the board header.
2. Enter the League ID and season, and click **Connect**.
3. Pick your team from the **My team…** dropdown so your roster shows in the
   MY TEAM panel.

If you get an "ESPN denied access" error, your league is private — continue
to Step 3.

### Step 3 — Get your cookies (private leagues)

Most home leagues are private, so ESPN needs proof you're a member. That
proof is two cookies from your logged-in espn.com session: `espn_s2` and
`SWID`.

1. Log in to [fantasy.espn.com](https://fantasy.espn.com) in a desktop
   browser and open your league.
2. Open the browser dev tools:
   - **Chrome / Edge:** press `F12` (or `Cmd+Option+I` on Mac), then go to
     **Application** → **Storage** → **Cookies** → `https://fantasy.espn.com`
   - **Firefox:** press `F12`, then **Storage** → **Cookies** →
     `https://fantasy.espn.com`
   - **Safari:** enable the Develop menu (Settings → Advanced → "Show
     features for web developers"), then **Develop** → **Show Web Inspector**
     → **Storage** → **Cookies**
3. In the cookie list, find:
   - **`espn_s2`** — a very long string (often containing `%` characters).
     Copy the entire **value**.
   - **`SWID`** — a shorter ID in curly braces, like
     `{1A2B3C4D-1234-5678-ABCD-1A2B3C4D5E6F}`. Copy it **including the
     braces**.
4. In the app, click **⚡ Sync ESPN draft** → **Private league?** and paste
   both values into their fields, then **Connect**.

Tips:

- Use the cookie value exactly as shown — don't URL-decode the `%xx`
  sequences in `espn_s2`.
- The cookies persist in your browser's localStorage so a page refresh
  mid-draft reconnects in two clicks. Click **Forget saved credentials** to
  remove them after your draft.
- These cookies grant full access to your ESPN account — treat them like a
  password and don't share screenshots of the panel. They typically stay
  valid for a long time, but if syncing suddenly fails with an auth error,
  log in to espn.com again and copy fresh values.

### Step 4 — Practice before draft day (recommended)

Check **Practice replay** in the connect form and set the season to **last
year**: the app fetches your league's completed draft and re-deals it one
pick every few seconds, exactly like a live draft — picks stream in, the
board crosses them off, and (once you choose your team) the MY TEAM panel
fills up. It's a full rehearsal of the live sync, plus confirmation that
your league ID, cookies, and team picker all work, without depending on a
live ESPN draft room.

### A note on ESPN mock drafts

ESPN's [Mock Draft Lobby](https://fantasy.espn.com/football/mockdraftlobby)
rooms are **not part of your league** — they run in a temporary league ESPN
creates for the mock. Connecting with your home league ID while you mock
draft will sync your *league's* draft (which hasn't started), not the mock
room, so the sheet sits at "waiting for picks."

For live mock-lobby sync, use the `leagueId` from the mock draft room's URL,
install the browser tap userscript, and check **Live ESPN mock draft** in the
Draft Sync panel. The userscript forwards mock-draft picks from your browser's
existing ESPN socket and strips the credential-bearing join token down to only
your team id, which lets the **My team** picker auto-fill when the script
loads before the draft starts. See
[`docs/mock-draft-live-sync-setup.md`](docs/mock-draft-live-sync-setup.md) for
the setup steps.

Practice replay is still the dependable way to rehearse without depending on
a live ESPN mock room.

---

## Architecture

```
frontend/ (React 18 + Vite)      backend/ (Python 3.12 + FastAPI)
  LeagueForm.jsx          →         POST /api/sheet
  DraftBoard.jsx                      ↓ Data orchestrator
  PlayerTable.jsx                     ├── Sleeper player map
  PrintView.jsx                       ├── Multi-source projection scraper
  useDraftState.js                    ├── nfl_data_py attrition curves + weekly variance
  ecrColor.js                         ├── Man-games baseline (Dupont)
                                      ├── VBD (Floor/VAL/Ceil)
                                      ├── Multi-method tiers (Jenks + GMM; Boris Chen scaffold)
                                      ├── Positional scarcity (PS%)
                                      ├── Auction dollar conversion
                                      └── ADP/ECR enrichment (FFC ADP + FantasyPros ECR)
```

### Key technical choices

| Decision | Rationale |
|---|---|
| Python 3.12 + FastAPI | Async-friendly; pandas/numpy/jenkspy are Python-native |
| React 18 + Vite | Interactive draft state; zero-cost Vercel hosting |
| Sleeper API | Free, no key; ESPN/Yahoo/MFL ID crosswalk built in |
| Jenks + GMM tiers | Two server-side 1-D clusterings of VAL for tiers — Jenks via jenkspy, GMM via a dependency-free 1-D EM; both selectable, plus manual edits |
| File-based JSON cache | No Redis needed in MVP; 12h preseason / 24h off-season TTL |
| CSS @media print | Zero-dependency printable layout; no headless browser |

---

## Deployment (Render + Vercel)

Deploying makes the app accessible from any browser — including Safari on iPad. No code changes required; both services read their config files automatically.

### Step 1 — Deploy the backend to Render

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect the GitHub repo (`InvaderFry/FFL-Draft-Sheet`)
3. Leave Root Directory blank
4. Under **Language**, select **Docker**
5. Set **Dockerfile Path** to: `./backend/Dockerfile`
6. Set **Docker Context Directory** to: `./backend`
7. Click **Deploy**
8. Once live, note your backend URL (e.g. `https://ffl-draft-sheet-api.onrender.com`)
9. Verify: visit `https://<your-render-url>/health` — should return `{"status":"ok"}`

> **Why set those paths?** `requirements.txt` and the `app/` folder live inside `backend/`, not the repo root. Without step 6, Render uses the repo root as the Docker build context and can't find those files.

> **Free tier caveat:** Render spins down services after 15 minutes of inactivity. The first request after a cold start takes 30–60 seconds. The $7/mo paid tier keeps the service always-on.

### Step 2 — Deploy the frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import `InvaderFry/FFL-Draft-Sheet`
2. Set **Root Directory** to `frontend` — this scopes Vercel to the React app only and prevents it from trying to deploy the backend as a second service
3. Before deploying, add an environment variable:
   - **Key:** `VITE_API_URL`
   - **Value:** `https://ffl-draft-sheet-api.onrender.com` (your Render URL from Step 1)
4. Click **Deploy** — Vercel auto-detects Vite and reads `frontend/vercel.json` automatically
5. Your app is live at `https://<your-project>.vercel.app`

### Step 3 — Open on iPad (or any browser)

Navigate to your Vercel URL in Safari. To add it to the iPad home screen as a shortcut:  
**Share → Add to Home Screen**

### Environment variables

| Variable | Service | Description | Default |
|---|---|---|---|
| `VITE_API_URL` | Frontend (Vercel) | Full URL of the Render backend | `''` (same-origin) |
| `CACHE_DIR` | Backend (Render) | Cache directory path | `cache/` |
| `WEB_CONCURRENCY` | Backend (Render) | Uvicorn worker count | `1` |
| `FANTASYPROS_API_KEY` | Backend (Render) | Enables real FantasyPros Expert Consensus Rankings (ECR). Optional — without it the ECR column falls back to FFC ADP (see below) | _(unset)_ |

> **FantasyPros ECR (optional).** "ECR" is FantasyPros' term — their
> consensus-rankings API is the canonical source. You can supply a
> [FantasyPros API key](https://www.fantasypros.com/apis/) two ways: set the
> `FANTASYPROS_API_KEY` env var on the backend (applies to everyone), **or**
> paste it into the optional **FantasyPros API key** field on the sheet-setup
> screen (per-request; a request key takes precedence over the env var, and is
> kept only in that browser tab's `sessionStorage`). Either way it populates the
> ECR column from real expert rankings — independent of ADP, which is what makes
> the ADP-divergence coloring meaningful. The free tier is **non-commercial**
> and rate-limited to **1 request/second, 100/day**; the backend fetches once
> per scoring format per day and caches the result, so a normal draft stays well
> within that. With no key supplied, nothing breaks — the board falls back to
> using FFC ADP as an ECR proxy (the prior behavior) and the board header shows
> an "ECR: ADP proxy" tag.

### Common issues

| Symptom | Likely cause |
|---|---|
| Frontend loads but draft sheet never returns | `VITE_API_URL` not set or pointing to wrong URL |
| Vercel shows multi-service detection / requires `experimentalServices` | Root Directory not set to `frontend` — Vercel scanned the whole repo and found the backend too |
| Vercel build fails | Root Directory not set to `frontend` |
| Build fails: `/app` or `/requirements.txt` not found | Docker Context Directory not set to `./backend` — Render used the repo root as context where those files don't exist |
| First request takes 30–60 s | Render free tier cold start — normal behavior |

---

## VBD algorithm

### Man-games baseline (Frank Dupont, 2012)

```
games_needed(pos) = n_teams × (starters[pos] + flex_slots × flex_alloc[pos]) × fantasy_weeks
```

Walk the positional attrition curve (3-year historical games-played-by-rank from nfl_data_py) until cumulative games ≥ games_needed. The player at that rank is the baseline. Expected values for a canonical 12-team 0.5-PPR 1-FLEX league: **QB ≈ 15, RB ≈ 44, WR ≈ 55, TE ≈ 19**.

### Value columns

```
VAL   = mean_pts − baseline_pts
Floor = (mean_pts − band) − baseline_pts
Ceil  = (mean_pts + band) − baseline_pts
```

`VAL` may be negative; sub-baseline values are intentional and are used by tiering and scarcity.

`band` comes from historical weekly outcome variance: player CV × projected mean, where CV is weekly stdev / weekly mean across the last three completed seasons. Known players without enough weekly samples fall back to their position's median CV. If weekly variance data or a player's historical identity is unavailable, the backend falls back to source σ; single-source players use σ = 12% × mean.

This scales the band with player caliber while measuring real outcome volatility instead of projection-site disagreement.

### Positional scarcity (PS%)

```
ps[i] = (Σ positive_val − Σ cumulative_val[0..i]) / Σ positive_val
```

Lower PS% = higher urgency (less value remains once this player is gone).

### Tiers (multi-method + dual display)

Each position is clustered into tiers on its VAL distribution. Players above the
baseline (VAL > 0) get up to `k-1` tiers from the chosen break method; the
sub-baseline tail is split into equal-count rank bands so granularity stays
consistent all the way down. The backend computes every method into a per-player
`tiers` map and mirrors the default (Jenks) into the flat `tier` field:

| Method | How |
|---|---|
| **Jenks** | Jenks natural breaks (`jenkspy`) — the default |
| **GMM** | A dependency-free 1-D Gaussian-mixture EM; tier breaks are the decision boundaries between mean-ordered components (Boris-Chen-style) |
| **Boris Chen** | Maps Boris Chen's published per-position tier CSV onto players by name (scaffold: inert until a CSV is dropped at `backend/app/data/boris_chen/<season>/<POS>.csv`) |
| **Manual** | Browser-side, seeded from any method, then nudged — stored in `localStorage` per `season:scoring` |

**Dual-encoding display.** The board exposes two independent channels so two
methods can be read at once:

- **Shade** — alternating light/dark row bands follow the selected method's tiers.
- **Lines** — a colored top-border rule marks a *second* method's tier
  boundaries. Where a line falls *inside* a shaded band, the two methods disagree.

**Manual editing.** Selecting **Manual** seeds boundaries from the active method.
A handle before each player name then toggles a tier break: **┃** starts a new
tier at that row, **╌** removes the break. Edits persist per league and apply to
both the interactive board and the printed sheet.

### Auction dollars

```
discretionary = n_teams × budget − n_rostered × $1
price[i] = $1 + (val[i] / Σ val) × discretionary
```

---

## Data sources (all free)

| Source | Used for |
|---|---|
| Sleeper API | Canonical player IDs, ESPN/Yahoo/MFL crosswalk |
| Fantasy Football Calculator | ADP (with prior-season fallback in the off-season); ECR proxy when no FantasyPros key |
| FantasyPros API | Expert Consensus Rankings (ECR) — requires `FANTASYPROS_API_KEY` |
| FantasyPros (HTML) | Consensus projections |
| FFToday | Projection scrape |
| NumberFire | Projection scrape |
| ESPN Fantasy API | Projection scrape |
| nfl_data_py (nflverse) | Historical games-played for attrition curves; weekly game logs for floor/ceiling variance |

---

## Stage 2 roadmap

- Live draft-room sync (ESPN / Sleeper / Yahoo)
- Real-time auction inflation as players go off the board
- Dynasty / keeper / IDP support
- Superflex / 2QB flex allocation
- Kicker (K) projection source + scoring
- Boris Chen live tier-data ingestion (the loader is scaffolded; needs a published-CSV fetch)
- Mobile PWA / offline caching
- DST Strength of Schedule grid

---

## Credits

Inspired by BeerSheets by Kevin Genson (@BeerSheets, discontinued 2023).  
Man-games baseline method: Frank Dupont (2012).  
Data: nflverse / nfl_data_py (CC-BY), Sleeper API, Fantasy Football Calculator.
