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

The frontend polls the backend proxy (`POST /api/draft/espn`) every ~5s during
a draft; the backend is a stateless pass-through in front of the league
endpoint.

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

   Param `5` is the composite join credential. Picks and clock events travel
   over this socket; the HAR contained no decoded frames, so the message
   protocol (the "KONA" channel format) is **not** reverse-engineered.
4. **Disney/BAM token refresh** via GraphQL at
   `https://espn.api.edge.bamgrid.com/graph/v1/device/graphql` — Disney SSO
   plumbing for the web shell, irrelevant to this app's cookie-based reads.

Season-level metadata also observed (not needed here):
`GET /seasons/{season}?view=proTeamSchedules_wl` and `?view=kona_game_state`.

## Mock Draft Lobby leagues cannot be synced by polling

Verified live (2026-06-12, mock league 283353968): the read API serves a
Mock Draft Lobby league with cookies (`view=mDraftDetail` returns 200,
`draftDetail.inProgress: true`, all pick slots pre-populated), **but the
pick slots never fill in while the draft runs** — ~20 real picks were made
in the room while every polled slot still carried a placeholder `playerId`.
Mock picks travel only over the draft WebSocket.

Mock-lobby leagues are identifiable in the response:

- `settings.draftSettings.leagueSubType == "MOCKDRAFT_LOBBY"` (present even
  with only `view=mDraftDetail`)
- `status.isViewable: false`

The backend detects the `leagueSubType` marker and rejects the league with
an explanatory 400 instead of letting the sheet poll forever at "waiting
for picks". Whether the slots backfill after a mock completes is unknown
(the temporary league is deleted soon after).

## Future upgrade path: real-time sync

If polling latency ever becomes a problem, the recipe is: fetch the
`draftSecurity` token with the user's cookies, then open the `JOIN` WebSocket
above and decode the pick frames. Polling was deliberately kept instead
because:

- it works for **public leagues with zero credentials**, while the socket
  requires SWID + teamId, i.e. an authenticated league member;
- the backend stays stateless (no per-draft socket connections to manage);
- the socket frame protocol still needs reverse-engineering (capture a draft
  with WebSocket frame recording enabled to get it).
