# Live ESPN Mock Draft Sync — Setup Guide

This guide sets up real-time pick sync between an ESPN Mock Draft Lobby room
and the FFL Draft Sheet using the browser userscript tap.

**Why a userscript?** ESPN allows only one active draft socket per
`(member, team)`. If the backend opens its own socket it kicks your browser,
and vice versa. The userscript reads the frames from _your_ existing browser
socket and forwards them to the sheet backend — one connection, no collision.

---

## Prerequisites

- [Tampermonkey](https://www.tampermonkey.net/) installed in your browser
  (Chrome, Firefox, Edge, or Safari all work)
- The FFL Draft Sheet backend running and reachable (local or deployed)
- An ESPN account with a Mock Draft Lobby league

---

## Step 1 — Find your backend URL

| Environment | URL |
|---|---|
| Local dev | `http://localhost:8000` |
| Deployed (Render, etc.) | your public service URL, e.g. `https://ffl-draft-sheet.onrender.com` |

You'll paste this into the userscript in the next step.

---

## Step 2 — Install the userscript

1. Open Tampermonkey in your browser and click **Create a new script**.
2. Delete the default template that appears.
3. Open [`tools/espn-draft-tap.user.js`](../tools/espn-draft-tap.user.js) from
   this repository and copy its entire contents.
4. Paste it into the Tampermonkey editor.
5. On **line 16**, replace the placeholder with your backend URL:

   ```js
   // Before
   const SHEET_API = 'https://YOUR-SHEET-BACKEND.example.com'

   // After (example)
   const SHEET_API = 'https://ffl-draft-sheet.onrender.com'
   // or for local dev:
   const SHEET_API = 'http://localhost:8000'
   ```

6. Click **File → Save** (or `Ctrl+S`).

The script is now active on any `https://fantasy.espn.com/football/draft*` URL.

> **If you installed a previous version of this script**, delete it and
> reinstall. The current version (0.2.0) adds two Tampermonkey grants in the
> header (`GM_xmlhttpRequest`, `unsafeWindow`) that are required for local
> development and correct WebSocket patching. An old copy without those grants
> will silently fail to send picks when your backend is on `http://localhost`.

### Why those grants are needed

| Grant | Purpose |
|---|---|
| `GM_xmlhttpRequest` + `@connect *` | Lets Tampermonkey make the POST from its own privileged extension context, bypassing the browser's mixed-content block (HTTPS ESPN page → HTTP localhost). Without this, Chrome silently drops every request to `http://localhost`. |
| `unsafeWindow` | Lets the script patch the real `window.WebSocket`, not Tampermonkey's sandbox proxy of it. Without this, ESPN's draft code never sees the patched constructor and the socket goes untapped. |

---

## Step 3 — Open the Draft Sheet tab

1. Open the FFL Draft Sheet in a separate browser tab.
2. In the **Draft Sync** panel, check **Live ESPN mock draft**.
   - The cookie / SWID fields will hide — they aren't needed.
   - A note appears with a link back to the userscript if you haven't
     installed it yet.
3. Enter your **League ID** and **Season** if they aren't already filled in.
4. Click **Connect**.

The sheet is now polling the backend's ingest store every ~5 seconds.

---

## Step 4 — Open the ESPN draft tab

1. Navigate to your Mock Draft Lobby on ESPN:
   `https://fantasy.espn.com/football/draft?leagueId=XXXXXX&seasonId=2026`

   > **Do this before the draft starts.** The userscript wraps `WebSocket`
   > at `document-start`, so a normal page load is enough — but picks made
   > before the page finishes loading won't be captured.

2. Look for a small pill in the bottom-right corner of the page:

   ```
   FFL tap: 0 picks sent
   ```

   If you see **"configure SHEET_API"** instead, go back to Step 2 and set
   the URL. If you see **"missing leagueId"** the page URL didn't include
   `leagueId` — navigate using ESPN's draft lobby link, not a bookmark.

---

## Step 5 — Draft

Once the mock draft starts, each pick appears in the pill counter and crosses
off on the draft sheet within one polling interval (~5 s):

```
FFL tap: 12 picks sent
```

The sheet tab shows picks accumulating in the **Draft Sync** panel in real
time. If the script was running when ESPN sent the room's join token, the
**My team** picker auto-fills from that sanitized team id. If it still says
**My team...**, choose your numbered team manually; the sheet can still infer
the selectable teams from picks.

---

## Step 6 — Draft ends

When the draft finishes (or you navigate away from the draft page), the
browser socket closes. The userscript sends a final `complete: true` POST,
and the sheet marks the session complete and stops polling.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No pill visible at all | Old script version (pre-0.2.0) missing `unsafeWindow` grant | Delete old script, reinstall from `tools/espn-draft-tap.user.js` |
| No pill visible at all | Tampermonkey not enabled or script not saved | Open Tampermonkey dashboard, confirm script is listed and toggled on |
| Pill says "configure SHEET_API" | Placeholder URL still in script | Edit line 16 in Tampermonkey |
| Pill says "missing leagueId" | Page URL missing `leagueId` param | Use ESPN's built-in draft lobby link |
| Pill says "send failed – retrying" on localhost | Old script missing `GM_xmlhttpRequest` grant (mixed-content block) | Delete old script, reinstall from `tools/espn-draft-tap.user.js` |
| Pill counter stays at 0 | Opened the draft page after picks started | Refresh the ESPN tab before the draft starts |
| My team picker does not auto-fill | Old script version (pre-0.3.0) or the ESPN tab loaded after the `TOKEN` frame | Reinstall the userscript, then reload the ESPN tab before the draft starts; otherwise choose the numbered team manually |
| Sheet shows 0 picks despite picks on pill | `mock_ingest` not checked | Check the "Live ESPN mock draft" box in Draft Sync |
| CORS error in browser console | Backend URL has a trailing slash | Remove the trailing `/` from `SHEET_API` |
| Sheet stops updating mid-draft | Navigated away from ESPN tab | Reload ESPN draft tab; picks resume on reconnect |
</content>
</invoke>
