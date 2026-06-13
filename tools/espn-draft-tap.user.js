// ==UserScript==
// @name         FFL Draft Sheet ESPN Draft Tap
// @namespace    https://github.com/InvaderFry/FFL-Draft-Sheet
// @version      0.1.0
// @description  Forward ESPN mock draft socket pick lines to FFL Draft Sheet.
// @match        https://fantasy.espn.com/football/draft*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict'

  // Set this to your deployed backend base URL, without a trailing slash.
  // Example for local development: http://localhost:8000
  const SHEET_API = 'https://YOUR-SHEET-BACKEND.example.com'

  const ESPN_SOCKET_HOST = 'fantasydraft.espn.com'
  const SEND_DEBOUNCE_MS = 250
  const PLACEHOLDER_API = 'https://YOUR-SHEET-BACKEND.example.com'
  const NativeWebSocket = window.WebSocket
  const pending = []
  let timer = null
  let selectedSent = 0
  let pill = null
  let completePending = false

  function draftIds() {
    const params = new URLSearchParams(window.location.search)
    const leagueId = params.get('leagueId') || params.get('leagueId'.toLowerCase())
    const season =
      params.get('seasonId') ||
      params.get('season') ||
      params.get('seasonId'.toLowerCase())
    return {
      league_id: leagueId ? Number(leagueId) : null,
      season: season ? Number(season) : new Date().getFullYear(),
    }
  }

  function ensurePill() {
    if (pill) return pill
    pill = document.createElement('div')
    pill.style.position = 'fixed'
    pill.style.right = '12px'
    pill.style.bottom = '12px'
    pill.style.zIndex = '2147483647'
    pill.style.padding = '5px 8px'
    pill.style.border = '1px solid rgba(255,255,255,0.25)'
    pill.style.borderRadius = '6px'
    pill.style.background = 'rgba(0,0,0,0.78)'
    pill.style.color = '#fff'
    pill.style.font = '12px/1.2 system-ui, -apple-system, Segoe UI, sans-serif'
    pill.style.pointerEvents = 'none'
    pill.textContent = 'FFL tap: waiting'
    const mount = () => {
      if (document.body && !pill.isConnected) document.body.appendChild(pill)
    }
    if (document.body) mount()
    else document.addEventListener('DOMContentLoaded', mount, { once: true })
    return pill
  }

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

  function wantedLine(line) {
    return /^(SELECTED|SELECTING|STATE)\b/.test(line.trim())
  }

  function enqueue(lines) {
    for (const line of lines) {
      if (wantedLine(line)) pending.push(line.trim())
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
      const resp = await fetch(`${api}/api/draft/espn/ingest`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: ids.league_id,
          season: ids.season,
          lines,
          complete: completePending,
        }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      selectedSent += lines.filter(line => line.startsWith('SELECTED ')).length
      setStatus(completePending
        ? `${selectedSent} picks sent, complete`
        : `${selectedSent} picks sent`)
      completePending = false
    } catch (_) {
      pending.unshift(...lines)
      timer = setTimeout(() => flush(false), 1000)
      setStatus('send failed')
    }
  }

  function isDraftSocket(url) {
    try {
      return new URL(String(url), window.location.href).host.includes(ESPN_SOCKET_HOST)
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
      ws.addEventListener('close', () => {
        flush(true)
      })
    }
    return ws
  }

  TapWebSocket.prototype = NativeWebSocket.prototype
  Object.setPrototypeOf(TapWebSocket, NativeWebSocket)
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    Object.defineProperty(TapWebSocket, key, {
      value: NativeWebSocket[key],
      enumerable: true,
    })
  }

  window.WebSocket = TapWebSocket
  ensurePill()
})()
