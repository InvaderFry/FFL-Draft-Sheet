# ESPN Fantasy Draft API notes

ESPN's fantasy API is undocumented and unofficial. Everything here was learned
by reading the API's behavior and from a HAR capture of a live mock-draft
session on `fantasy.espn.com/football/draft` (2026 season). The machine-readable
version of the capture is in [`espn-draft-api.openapi.json`](espn-draft-api.openapi.json);
all personal identifiers in it (league id, SWID, tokens) have been replaced
with placeholders.

> **Caveat:** the spec was inferred from a single capture whose largest
> response body was truncated at 1 MB. Trust the endpoint paths, parameter
> names, and field names; treat the `required` lists and full schemas as
> best-effort guesses.

## Base API

```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl
```

**Auth:** ESPN session cookies. `SWID` + `espn_s2` is the minimal working set
(and all this app forwards); the web client also carries Disney/ONESITE
cookies (`ESPN-ONESITE.WEB-PROD.token`, `espnAuth`, `dtcAuth`) that are not
needed for these reads. Public leagues need no cookies at all.

Responses are selected with one or more repeated `view` query parameters
against the same league endpoint:

```
GET /seasons/{season}/segments/0/leagues/{leagueId}?view=...
```

## What this app uses

| Call | Where | Purpose |
|---|---|---|
| League endpoint, `view=mDraftDetail&view=mTeams` | `backend/app/providers/espn.py` | Draft picks (`draftDetail.picks`, `inProgress`, `drafted`) and team names. Lean payload, safe to poll. |
| `GET /seasons/{season}/players` | `backend/app/data/espn_players.py` | Player-id → name/pos/team directory, used as a fallback when the Sleeper bridge can't identify a pick. |
| `POST /api/draft/espn/ingest` | `backend/app/providers/espn_ws.py` | Browser userscript ingress for mock-draft socket lines (`SELECTED`, `SELECTING`, `STATE`). |

For regular drafts, the frontend polls the backend proxy
(`POST /api/draft/espn`) every ~5s during a draft; the backend is a stateless
pass-through in front of the league endpoint. Mock Draft Lobby rooms use the
browser-side ingest store described below.

Parsing quirks handled in `espn.py`:

- ESPN pre-populates a slot for **every** pick before/during the draft.
  Un-made picks carry a placeholder `playerId` of `0` or `-1` and must be
  filtered out.
- D/ST picks are encoded as `playerId = -16000 - proTeamId` (the
  `ESPN_PRO_TEAMS` map decodes them).
- The `leagueHistory` variant of the endpoint wraps the league object in a
  list.

## What the real draft client does differently (from the HAR)

The draft room web app uses the same base API but a different flow:

1. **Bootstrap:** league endpoint with `view=draftInit&view=mSettings` plus a
   JSON-encoded `filter` query param (e.g.
   `{"players":{"filterStatsForContainerIds":{"value":["002025","102026"]}}}`).
   This single response (>1 MB; it was truncated in the capture) contains the
   draft state, league settings, **and the full draftable player pool** with
   names, ADP, ownership, and draft ranks.
2. **Draft security token:**

   ```
   GET /seasons/{season}/segments/0/leagues/{leagueId}/teams/{teamId}/draftSecurity
   ```

   Returns a bare JSON integer (e.g. `111111111`). Requires cookies and is
   fetched immediately before joining the draft room.
3. **Real-time pick feed — WebSocket:**

   ```
   wss://fantasydraft.espn.com/game-1/league-{leagueId}/JOIN
       ?1={gameId}&2={leagueId}&3={teamId}&4={SWID}
       &5={gameId}:{leagueId}:{teamId}:{SWID}:{draftSecurityToken}
       &6=false&7=false&8=KONA&nocache={random}
   ```

   Param `5` is the composite join credential. The handshake sends
   `Origin: https://fantasy.espn.com` and a browser User-Agent; the join URL
   itself carries all auth. See the protocol reference below.
4. **Disney/BAM token refresh** via GraphQL at
   `https://espn.api.edge.bamgrid.com/graph/v1/device/graphql` — Disney SSO
   plumbing for the web shell, irrelevant to this app's cookie-based reads.

Season-level metadata also observed (not needed here):
`GET /seasons/{season}?view=proTeamSchedules_wl` and `?view=kona_game_state`.

## Mock Draft Lobby live sync uses a browser-side socket tap

Verified live (2026-06-12, mock league 283353968): the read API serves a
Mock Draft Lobby league with cookies (`view=mDraftDetail` returns 200,
`draftDetail.inProgress: true`, all pick slots pre-populated), **but the
pick slots never fill in while the draft runs** — ~20 real picks were made
in the room while every polled slot still carried a placeholder `playerId`.
Mock picks travel only over the draft WebSocket.

The backend originally joined that WebSocket as a second room member using
the user's SWID + team id. That syncs picks, but ESPN allows only one active
draft socket for a `(member, team)` pair: the backend join kicks the browser,
the browser reconnect kicks the backend, and the user sees a broken draft
room. A kicked backend socket also looks like a clean room close, which can
produce a false "Draft complete" state.

The current architecture keeps one ESPN draft socket:

```
ESPN draft tab (tools/espn-draft-tap.user.js)
  -> POST /api/draft/espn/ingest
  -> in-memory store keyed by (league_id, season)
  <- POST /api/draft/espn with mock_ingest=true
sheet tab
```

The Tampermonkey userscript runs at `document-start`, wraps `window.WebSocket`,
listens only to sockets whose URL contains `fantasydraft.espn.com`, and
forwards `SELECTED` / `SELECTING` / `STATE` lines to the sheet backend. The
backend reuses the same `parse_frame` decoder and pick enrichment path as the
old socket client. No ESPN cookies are sent to the sheet backend for mock
drafts; the browser is already authenticated to ESPN.

Mock-lobby leagues are identifiable in the response:

- `settings.draftSettings.leagueSubType == "MOCKDRAFT_LOBBY"` (present even
  with only `view=mDraftDetail`)
- `status.isViewable: false`

The backend detects the `leagueSubType` marker and returns a snapshot from
the ingest store. The frontend can also force that path with
`mock_ingest: true`, which is the reliable path when the userscript is
installed. A mock league whose `draftDetail.drafted` is already true parses
via REST — the room no longer exists to tap. Whether the REST slots backfill
after a mock completes is unknown (the temporary league is deleted soon
after).

Known limitations:

- The userscript must be installed once and its `SHEET_API` constant must be
  set to the deployed backend base URL.
- Picks made before the userscript loads are not captured. Install it and
  load the ESPN draft page before the draft starts.
- Navigating away from the draft page closes the browser socket. The
  userscript posts `complete: true` on close, so the sheet ends that sync
  session.

## Draft-room WebSocket protocol

Decoded from a Chrome HAR (`_webSocketMessages`) of a live mock draft
(2026-06-12, league 1242111363). Line-based text frames, newline-terminated.

Server → client:

| Frame | Meaning |
|---|---|
| `TOKEN 1:{leagueId}:{teamId}:{SWID}:{token}` | join acknowledged (echoes the credential) |
| `INIT <binary blob>` | pre-draft room state; **undecoded** — picks made before connecting are not recoverable from it |
| `STATE 1` | draft started |
| `SELECTING <teamId> <msBudget>` | team on the clock (e.g. `SELECTING 12 30000`) |
| `SELECTED <teamId> <playerId> <slotId> [{memberSWID}]` | pick made; SWID absent on autopicks; playerIds are real ESPN ids |
| `CLOCK <phase> <msRemaining> [teamId]` | countdown ticks (~5s apart); phase 0 = pre-draft lobby, 6 = picking |
| `JOINED <teamId> {SWID}` / `LEFT <teamId> {SWID} <n>` | room presence |
| `AUTODRAFT <teamId> <bool>` | autopick toggled |
| `AUTOSUGGEST <playerId>` | the room's suggested next pick |
| `PONG PING%20<ts>` | keepalive echo |

Client → server:

| Frame | Meaning |
|---|---|
| `PING PING%20<msTimestamp>` | keepalive, sent every ~15s — required or the server drops idle members |
| `SELECT <playerId>` | make a pick (this app never sends it) |
| `DRAFT_LIST <playerId> [...]` | sync the draft queue (echoed back) |

Notes:

- **Overall pick number = SELECTED event sequence.** The first frame field
  is the team/slot id; snake order is visible as `SELECTING 1…12, 12…1`.
- `SELECTED`'s third number tracks the player's lineup-slot/position id
  (2 = RB, 4 = WR observed); not needed when the player map has the id.
- This app no longer joins the room. The userscript reads the browser's own
  socket frames and accumulates `SELECTED` events into the same `DraftStatus`
  the polling endpoint already serves. Connect **before the draft starts** —
  INIT is undecoded, so picks made before the tap loads are unavailable.

For regular (non-mock) leagues, REST polling remains the path: it works for
public leagues with zero credentials and keeps the backend stateless.
