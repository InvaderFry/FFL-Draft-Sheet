import { describe, expect, it } from 'vitest'
import { toCsv } from './exportCsv'

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  row.push(field)
  rows.push(row)
  return rows
}

describe('exportCsv', () => {
  it('escapes commas, quotes, and newlines', () => {
    expect(toCsv(
      ['Player', 'Note'],
      [
        ['Ja"marr, Chase', 'line\nbreak'],
        ['Plain', null],
      ]
    )).toBe('Player,Note\n"Ja""marr, Chase","line\nbreak"\nPlain,')
  })

  it('round-trips mixed CSV fields', () => {
    const rows = [
      ['1', 'RB', 'Bijan Robinson', 'ATL', '12', '42.5'],
      ['2', 'WR', 'Comma, Quote " Name', 'CIN', '', '-1'],
    ]

    const parsed = parseCsv(toCsv(['Overall', 'Pos', 'Player', 'Team', 'Bye', 'Value'], rows))

    expect(parsed).toEqual([
      ['Overall', 'Pos', 'Player', 'Team', 'Bye', 'Value'],
      ...rows,
    ])
  })
})
