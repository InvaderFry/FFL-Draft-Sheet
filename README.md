# 🍺 FFL Draft Sheet

**A free, league-customizable fantasy football draft cheat sheet** — the BeerSheets-style tool the r/fantasyfootball community has been missing since 2023.

Generates a Value-Based Drafting board with man-games baseline, Jenks natural-break tiers, ECR round|pick formatting, and a printable one-page layout — all from public data, no paid subscriptions required.

---

## Features

- **Value-Based Drafting (VBD)** with the Frank Dupont "man-games" replacement baseline
- **Floor / VAL / Ceiling** columns using historical weekly outcome variance, with source-σ fallback
- **Jenks natural-break tiers** (12 for RB/WR, 8 for QB/TE, 6 for DST)
- **Positional scarcity (PS%)** — share of value remaining after each player
- **ECR** formatted as `round|pick` with ADP-divergence coloring (blue = going earlier, orange = later)
- **Auction dollar values** using the standard VBD-to-dollars formula
- **Click-to-cross-off** drafted players; state persists for the session
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

**Response:** Player rows per position with `val`, `floor`, `ceil`, `ps_pct`, `ecr_fmt`, `tier`, `tier_is_even`.

> **Note:** `K` (kicker) is accepted in the request for forward-compatibility but is
> not yet scored — there is no kicker projection source wired in, so the response
> contains no `K` position block. See the Stage 2 roadmap.

Full schema auto-generated at `/docs`.

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
                                      ├── Jenks tier assignment
                                      ├── Positional scarcity (PS%)
                                      ├── Auction dollar conversion
                                      └── FFC ADP enrichment
```

### Key technical choices

| Decision | Rationale |
|---|---|
| Python 3.12 + FastAPI | Async-friendly; pandas/numpy/jenkspy are Python-native |
| React 18 + Vite | Interactive draft state; zero-cost Vercel hosting |
| Sleeper API | Free, no key; ESPN/Yahoo/MFL ID crosswalk built in |
| Jenks natural breaks | Best 1-D clustering for VBD tiers (jenkspy library) |
| File-based JSON cache | No Redis needed in MVP; 12h preseason / 24h off-season TTL |
| CSS @media print | Zero-dependency printable layout; no headless browser |

---

## Deployment (Render + Vercel)

Deploying makes the app accessible from any browser — including Safari on iPad. No code changes required; both services read their config files automatically.

### Step 1 — Deploy the backend to Render

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect the GitHub repo (`InvaderFry/FFL-Draft-Sheet`)
3. **Leave Root Directory blank (repo root)** — this is where `render.yaml` lives
4. Render auto-detects `render.yaml` and configures the Docker service
5. Click **Deploy**
6. Once live, note your backend URL (e.g. `https://ffl-draft-sheet-api.onrender.com`)
7. Verify: visit `https://<your-render-url>/health` — should return `{"status":"ok"}`

> **Free tier caveat:** Render spins down services after 15 minutes of inactivity. The first request after a cold start takes 30–60 seconds. The $7/mo paid tier keeps the service always-on.

### Step 2 — Deploy the frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import `InvaderFry/FFL-Draft-Sheet`
2. **Leave Root Directory blank (repo root)** — this is where `vercel.json` lives
3. Before deploying, add an environment variable:
   - **Key:** `VITE_API_URL`
   - **Value:** `https://ffl-draft-sheet-api.onrender.com` (your Render URL from Step 1)
4. Click **Deploy** — Vercel reads `vercel.json` automatically
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

### Common issues

| Symptom | Likely cause |
|---|---|
| Frontend loads but draft sheet never returns | `VITE_API_URL` not set or pointing to wrong URL |
| Build fails on Render or Vercel | Root Directory not left blank / set to repo root |
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
| Fantasy Football Calculator | ADP as ECR proxy |
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
- GMM tier method (Boris Chen style) as alternative
- Mobile PWA / offline caching
- DST Strength of Schedule grid

---

## Credits

Inspired by BeerSheets by Kevin Genson (@BeerSheets, discontinued 2023).  
Man-games baseline method: Frank Dupont (2012).  
Data: nflverse / nfl_data_py (CC-BY), Sleeper API, Fantasy Football Calculator.
