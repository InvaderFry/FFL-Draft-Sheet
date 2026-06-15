// ==UserScript==
// @name         FFL Draft Sheet ESPN Draft Tap
// @namespace    https://github.com/InvaderFry/FFL-Draft-Sheet
// @version      0.3.0
// @description  Forward ESPN mock draft socket pick lines to FFL Draft Sheet.
// @match        https://fantasy.espn.com/football/draft*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// ==/UserScript==

(function () {
  'use strict'

  // Set this to your deployed backend base URL, without a trailing slash.
  // Example for local development: http://localhost:8000
  const SHEET_API = 'https://YOUR-SHEET-BACKEND.example.com'

  const ESPN_SOCKET_HOST = 'fantasydraft.espn.com'
  const SEND_DEBOUNCE_MS = 250
  const PLACEHOLDER_API = 'https://YOUR-SHEET-BACKEND.example.com'

  // Use unsafeWindow when available so the WebSocket wrap reaches the real
  // page window, not Tampermonkey's sandbox proxy.
  const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window
  const NativeWebSocket = W.WebSocket

  const pending = []
  let timer = null
  let selectedSent = 0
  let pill = null
  let completePending = false

  // ---------- pill ----------

  function ensurePill() {
    if (pill) return pill
    pill = document.createElement('div')
    pill.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
      'padding:5px 8px', 'border:1px solid rgba(255,255,255,0.25)',
      'border-radius:6px', 'background:rgba(0,0,0,0.78)', 'color:#fff',
      'font:12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif',
      'pointer-events:none',
    ].join(';')
    pill.textContent = 'FFL tap: waiting'
    const mount = () => {
      if (document.body && !pill.isConnected) document.body.appendChild(pill)
    }
    if (document.body) mount()
    else document.addEventListener('DOMContentLoaded', mount, { once: true })
    return pill
  }

  // ESPN's React shell re-renders body after DOMContentLoaded and removes
  // nodes that were appended during page load.  Re-attach the pill whenever
  // it drops out of the DOM.
  setInterval(() => {
    if (pill && !pill.isConnected && document.body) document.body.appendChild(pill)
  }, 500)

  function setStatus(text) {
    ensurePill().textContent = `FFL tap: ${text}`
  }

  function configuredApi() {
    const api = SHEET_API.replace(/\/+$/, '')
    if (!api || api === PLACEHOLDER_API) {
      setStatus('configure SHEET_API')
      return null
    }
    return api
  }

  // ---------- URL parsing ----------

  function draftIds() {
    const params = new URLSearchParams(W.location.search)
    const leagueId = params.get('leagueId') || params.get('leagueid')
    const season =
      params.get('seasonId') || params.get('season') || params.get('seasonid')
    return {
      league_id: leagueId ? Number(leagueId) : null,
      season: season ? Number(season) : new Date().getFullYear(),
    }
  }

  // ---------- network ----------

  // GM_xmlhttpRequest runs in Tampermonkey's privileged extension context so
  // it bypasses mixed-content restrictions (HTTPS page → HTTP localhost) and
  // CORS entirely.  Falls back to native fetch for contexts where GM is absent.
  function gmPost(url, body) {
    return new Promise((resolve, reject) => {
      const fn =
        typeof GM_xmlhttpRequest !== 'undefined'
          ? GM_xmlhttpRequest
          : (typeof GM !== 'undefined' && GM.xmlHttpRequest)
              ? r => GM.xmlHttpRequest(r)
              : null

      if (!fn) {
        fetch(url, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(r => {
          if (!r.ok) reject(new Error(`HTTP ${r.status}`))
          else resolve()
        }).catch(reject)
        return
      }

      fn({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(body),
        onload: r => {
          if (r.status < 200 || r.status >= 300) reject(new Error(`HTTP ${r.status}`))
          else resolve()
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      })
    })
  }

  // ---------- frame accumulation ----------

  function wantedLine(line) {
    return /^(SELECTED|SELECTING|STATE|TOKEN)\b/.test(line.trim())
  }

  function sanitizeLine(line) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('TOKEN')) return trimmed
    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) return null
    const tokenParts = parts[1].split(':')
    const teamId = tokenParts.length >= 3 ? tokenParts[2] : parts[1]
    return /^\d+$/.test(teamId) ? `TOKEN ${teamId}` : null
  }

  function enqueue(lines) {
    for (const line of lines) {
      if (wantedLine(line)) {
        const sanitized = sanitizeLine(line)
        if (sanitized) pending.push(sanitized)
      }
    }
    if (pending.length === 0) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => flush(false), SEND_DEBOUNCE_MS)
  }

  async function flush(complete) {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    completePending = completePending || Boolean(complete)
    const api = configuredApi()
    if (!api) return

    const lines = pending.splice(0)
    if (lines.length === 0 && !completePending) return

    const ids = draftIds()
    if (!ids.league_id || !ids.season) {
      setStatus('missing leagueId')
      return
    }

    try {
      await gmPost(`${api}/api/draft/espn/ingest`, {
        league_id: ids.league_id,
        season: ids.season,
        lines,
        complete: completePending,
      })
      selectedSent += lines.filter(l => l.startsWith('SELECTED ')).length
      setStatus(completePending
        ? `${selectedSent} picks sent, complete`
        : `${selectedSent} picks sent`)
      completePending = false
    } catch (_) {
      pending.unshift(...lines)
      timer = setTimeout(() => flush(false), 1000)
      setStatus('send failed – retrying')
    }
  }

  // ---------- WebSocket tap ----------

  function isDraftSocket(url) {
    try {
      return new URL(String(url), W.location.href).host.includes(ESPN_SOCKET_HOST)
    } catch (_) {
      return String(url).includes(ESPN_SOCKET_HOST)
    }
  }

  function TapWebSocket(url, protocols) {
    const ws = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols)

    if (isDraftSocket(url)) {
      setStatus('connected')
      ws.addEventListener('message', event => {
        if (typeof event.data === 'string') enqueue(event.data.split(/\r?\n/))
      })
      ws.addEventListener('close', () => flush(true))
    }
    return ws
  }

  TapWebSocket.prototype = NativeWebSocket.prototype
  Object.setPrototypeOf(TapWebSocket, NativeWebSocket)
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    Object.defineProperty(TapWebSocket, key, { value: NativeWebSocket[key], enumerable: true })
  }

  W.WebSocket = TapWebSocket
  ensurePill()
})()
