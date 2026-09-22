import { describe, it, expect, vi, beforeEach } from 'vitest'

// De export praat met Supabase en met de browser (download). Beide worden
// hier vervangen, zodat we kunnen vastleggen welke filters de query krijgt
// en wat er in de CSV terechtkomt.
interface QueryCall { filters: Array<[string, string, string]> }
const calls: QueryCall[] = []
let approvedRows: unknown[] = []

vi.mock('../lib/supabase', () => {
  const builder = (table: string) => {
    const call: QueryCall = { filters: [] }
    const q = {
      select: () => q,
      eq: (col: string, val: string) => { call.filters.push(['eq', col, val]); return q },
      gte: (col: string, val: string) => { call.filters.push(['gte', col, val]); return q },
      lte: (col: string, val: string) => { call.filters.push(['lte', col, val]); return q },
      in: () => q,
      then: (resolve: (r: { data: unknown[]; error: null }) => void) => {
        if (table === 'assignments') { calls.push(call); return resolve({ data: approvedRows, error: null }) }
        return resolve({
          data: [{ id: 'u1', full_name: 'Manal', email: 'manal@adhdmc.nl' }],
          error: null,
        })
      },
    }
    return q
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

const downloads: Array<{ filename: string; csv: string }> = []
vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
vi.stubGlobal('Blob', class { constructor(public parts: string[]) {} })

import { exportHours, exportDetails, ExportRange } from './export'

function shift(date: string, type: 'ochtend' | 'middag') {
  const t = type === 'ochtend'
    ? { start_time: '08:30', end_time: '12:30', duration_hours: 4 }
    : { start_time: '12:00', end_time: '17:30', duration_hours: 5.5 }
  return { user_id: 'u1', attendance: 'gewerkt', custom_start_time: null, custom_end_time: null,
           shifts: { shift_date: date, shift_type: type, ...t } }
}

beforeEach(() => {
  calls.length = 0
  downloads.length = 0
  approvedRows = []
  // jsdom-vrije download-stub.
  const a = { href: '', download: '', click: () => {} }
  vi.stubGlobal('document', {
    createElement: () => a,
    body: { appendChild: () => {}, removeChild: () => {} },
  })
  const origBlob = globalThis.Blob
  vi.stubGlobal('Blob', class {
    csv: string
    constructor(parts: string[]) { this.csv = parts.join('') }
  })
  void origBlob
})

// Vangt de CSV op door de download-stub te lezen.
async function run(fn: () => Promise<{ ok: boolean }>, capture = true) {
  let captured = ''
  let filename = ''
  vi.stubGlobal('Blob', class { constructor(parts: string[]) { captured = parts.join('') } })
  const a = { href: '', download: '', click: () => {} }
  vi.stubGlobal('document', {
    createElement: () => a,
    body: { appendChild: () => {}, removeChild: () => { filename = a.download } },
  })
  const res = await fn()
  // De eerste byte is de UTF-8 BOM voor Excel; die hoort niet bij de inhoud.
  if (capture) downloads.push({ filename, csv: captured.replace(/^\uFEFF/, '') })
  return res
}

const loonperiode: ExportRange = { from: '2026-08-21', to: '2026-09-20' }

describe('urenexport: datumbereik', () => {
  it('filtert alleen op datum, niet op roosterperiode', async () => {
    approvedRows = [shift('2026-08-21', 'ochtend')]
    await run(() => exportHours(loonperiode))

    const filters = calls[0].filters
    expect(filters).toContainEqual(['gte', 'shifts.shift_date', '2026-08-21'])
    expect(filters).toContainEqual(['lte', 'shifts.shift_date', '2026-09-20'])
    // De bug: een filter op period_id kapte de dagen uit de vorige maand af.
    expect(filters.some(([, col]) => col === 'shifts.period_id')).toBe(false)
  })

  it('telt de dagen uit beide maanden van een loonperiode mee', async () => {
    approvedRows = [
      shift('2026-08-24', 'ochtend'), shift('2026-08-24', 'middag'),  // 4 + 5,5 - 0,5 overlap - 0,5 pauze = 8,5
      shift('2026-09-02', 'ochtend'),                                  // 4
    ]
    await run(() => exportHours(loonperiode))

    const line = downloads[0].csv.split('\r\n').find(l => l.startsWith('Manal'))!
    // Kolom 'Totaal verloonde uren' is de elfde kolom.
    expect(line.split(';')[10]).toBe('12,5')
  })

  it('noemt het volledige bereik met jaar in titel en bestandsnaam', async () => {
    approvedRows = [shift('2026-08-21', 'ochtend')]
    await run(() => exportHours(loonperiode))

    expect(downloads[0].filename).toBe('uren-21-08-2026-tm-20-09-2026.csv')
    expect(downloads[0].csv.split('\r\n')[0]).toBe('Urenexport 21-08-2026 t/m 20-09-2026')
  })

  it('houdt de korte maandnaam bij een hele kalendermaand', async () => {
    approvedRows = [shift('2026-09-02', 'ochtend')]
    await run(() => exportHours({ from: '2026-09-01', to: '2026-09-30' }))

    expect(downloads[0].filename).toBe('uren-september-2026.csv')
    expect(downloads[0].csv.split('\r\n')[0]).toBe('Urenexport september 2026')
  })

  it('zet in de detailexport het jaar van de dienst zelf in de datumkolom', async () => {
    // Loonperiode over de jaargrens: december-dagen mogen geen 2027 krijgen.
    approvedRows = [shift('2026-12-22', 'ochtend'), shift('2027-01-05', 'ochtend')]
    await run(() => exportDetails({ from: '2026-12-21', to: '2027-01-20' }))

    const lines = downloads[0].csv.split('\r\n')
    expect(lines.some(l => l.startsWith('22-12-2026;'))).toBe(true)
    expect(lines.some(l => l.startsWith('05-01-2027;'))).toBe(true)
  })
})
