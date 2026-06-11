import { supabase } from '../lib/supabase'
import { RosterPeriod } from '../types'
import { monthLabel, MONTHS_NL } from './dates'
import { hoursBetween } from './shiftTimes'

interface ExportRow {
  shift_date: string
  shift_type: string
  start_time: string
  end_time: string
  duration_hours: number
}

interface StudentTotals {
  name: string
  email: string
  days: Set<string>
  shifts: number
  ochtend: number
  middag: number
  hours: number
  sick: number
  absent: number
}

// Nederlandse getalnotatie (komma als decimaalteken).
function nl(n: number): string {
  return (Math.round(n * 100) / 100).toString().replace('.', ',')
}

// CSV-veld veilig maken (puntkomma-gescheiden, voor Excel NL).
function cell(value: string | number): string {
  const s = String(value)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function triggerDownload(filename: string, csv: string) {
  // BOM zodat Excel UTF-8 (accenten) correct toont.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Haalt de goedgekeurde (= gewerkte) diensten van een periode op en
 * downloadt een CSV met per medewerker: gewerkte dagen, aantal diensten
 * en totaal uren. Bedoeld voor de financiële administratie.
 */
export async function exportPeriodHours(period: RosterPeriod): Promise<{ ok: boolean; message?: string }> {
  const shiftCols = 'shifts!inner(shift_date, shift_type, start_time, end_time, duration_hours, period_id)'

  // '*' zodat ook attendance en de afwijkende werktijden meekomen,
  // ongeacht welke migraties al zijn uitgevoerd.
  const { data, error } = await supabase
    .from('assignments')
    .select(`*, ${shiftCols}`)
    .eq('status', 'approved')
    .eq('shifts.period_id', period.id)

  if (error) return { ok: false, message: error.message }
  if (!data || data.length === 0) return { ok: false, message: 'Geen goedgekeurde diensten in deze periode.' }

  const userIds = [...new Set(data.map((r: any) => r.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))

  // Aggregeren per medewerker.
  const totals = new Map<string, StudentTotals>()
  for (const row of data as any[]) {
    const shift = row.shifts as ExportRow
    const prof = profileMap.get(row.user_id)
    let t = totals.get(row.user_id)
    if (!t) {
      t = {
        name: prof?.full_name || prof?.email || 'Onbekend',
        email: prof?.email || '',
        days: new Set(),
        shifts: 0,
        ochtend: 0,
        middag: 0,
        hours: 0,
        sick: 0,
        absent: 0,
      }
      totals.set(row.user_id, t)
    }
    const att = row.attendance || 'gewerkt'
    if (att === 'ziek') { t.sick += 1; continue }
    if (att === 'afwezig') { t.absent += 1; continue }
    // Alleen 'gewerkt' telt als gewerkte tijd; afwijkende werktijden
    // van deze medewerker gaan vóór de standaardduur van de dienst.
    t.days.add(shift.shift_date)
    t.shifts += 1
    if (shift.shift_type === 'ochtend') t.ochtend += 1
    else if (shift.shift_type === 'middag') t.middag += 1
    t.hours += row.custom_start_time && row.custom_end_time
      ? hoursBetween(row.custom_start_time, row.custom_end_time)
      : Number(shift.duration_hours)
  }

  const rows = [...totals.values()].sort((a, b) => a.name.localeCompare(b.name))

  const header = ['Naam', 'E-mail', 'Gewerkte dagen', 'Gewerkte diensten', 'Ochtenddiensten', 'Middagdiensten', 'Gewerkte uren', 'Ziek (diensten)', 'Afwezig (diensten)']
  const lines = [header.map(cell).join(';')]
  for (const r of rows) {
    lines.push([
      cell(r.name),
      cell(r.email),
      r.days.size,
      r.shifts,
      r.ochtend,
      r.middag,
      cell(nl(r.hours)),
      r.sick,
      r.absent,
    ].join(';'))
  }
  // Totaalregel onderaan.
  lines.push([
    cell('TOTAAL'), '', '',
    rows.reduce((n, r) => n + r.shifts, 0),
    rows.reduce((n, r) => n + r.ochtend, 0),
    rows.reduce((n, r) => n + r.middag, 0),
    cell(nl(rows.reduce((n, r) => n + r.hours, 0))),
    rows.reduce((n, r) => n + r.sick, 0),
    rows.reduce((n, r) => n + r.absent, 0),
  ].join(';'))

  const monthName = MONTHS_NL[period.month - 1]
  triggerDownload(`uren-${monthName}-${period.year}.csv`, lines.join('\r\n'))
  return { ok: true, message: `Export voor ${monthLabel(period.year, period.month)} gedownload.` }
}
