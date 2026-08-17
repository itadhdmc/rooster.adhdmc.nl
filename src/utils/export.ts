import { supabase } from '../lib/supabase'
import { Profile, RosterPeriod } from '../types'
import { monthLabel, MONTHS_NL } from './dates'
import { rowHours, rowTimes, dayPaidHours, PAUSE_START, PAUSE_END } from './paidHours'

interface ExportShiftRow {
  shift_date: string
  shift_type: string
  start_time: string
  end_time: string
  duration_hours: number
}

// Assignment-rij zoals de export-query die teruggeeft (met geneste dienst).
interface AssignmentExportRow {
  user_id: string
  attendance: string | null
  custom_start_time: string | null
  custom_end_time: string | null
  shifts: ExportShiftRow
}

// Datumbereik (ISO, beide inclusief) waarover geëxporteerd wordt.
export interface ExportRange {
  from: string
  to: string
}

interface StudentTotals {
  name: string
  email: string
  days: Set<string>
  shifts: number
  ochtend: number
  middag: number
  saturdayShifts: number
  weekdayHours: number
  saturdayHours: number
  pauseHours: number
  sick: number
  sickHours: number
  absent: number
  absentHours: number
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

function isSaturdayISO(dateStr: string): boolean {
  return new Date(dateStr + 'T00:00:00').getDay() === 6
}

function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
}

function ddmm(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${d}-${m}`
}


// Bestandsnaamdeel voor het bereik: leeg bij een hele maand, anders "01-08-tm-15-08".
function rangeSuffix(period: RosterPeriod, range: ExportRange): string {
  const monthStart = `${period.year}-${String(period.month).padStart(2, '0')}-01`
  const lastDay = new Date(period.year, period.month, 0).getDate()
  const monthEnd = `${period.year}-${String(period.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  if (range.from === monthStart && range.to === monthEnd) return ''
  return `-${ddmm(range.from)}-tm-${ddmm(range.to)}`
}

function rangeLabel(period: RosterPeriod, range: ExportRange): string {
  const base = monthLabel(period.year, period.month)
  return rangeSuffix(period, range) === '' ? base : `${base} (${ddmm(range.from)} t/m ${ddmm(range.to)})`
}

async function fetchApproved(period: RosterPeriod, range: ExportRange): Promise<
  { ok: true; rows: AssignmentExportRow[]; profiles: Map<string, Pick<Profile, 'id' | 'full_name' | 'email'>> } | { ok: false; message: string }
> {
  const shiftCols = 'shifts!inner(shift_date, shift_type, start_time, end_time, duration_hours, period_id)'
  const { data, error } = await supabase
    .from('assignments')
    .select(`*, ${shiftCols}`)
    .eq('status', 'approved')
    .eq('shifts.period_id', period.id)
    .gte('shifts.shift_date', range.from)
    .lte('shifts.shift_date', range.to)

  if (error) return { ok: false, message: error.message }
  if (!data || data.length === 0) return { ok: false, message: 'Geen goedgekeurde diensten in dit bereik.' }

  const rows = data as AssignmentExportRow[]
  const userIds = [...new Set(rows.map(r => r.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)

  const profileMap = new Map(
    ((profiles || []) as Pick<Profile, 'id' | 'full_name' | 'email'>[]).map(p => [p.id, p])
  )
  return { ok: true, rows, profiles: profileMap }
}

/**
 * Overzicht per medewerker (CSV): gewerkte dagen/diensten, uren gesplitst
 * in doordeweeks en zaterdag (i.v.m. toeslag), ziekte- en afwezigheidsuren,
 * plus weektotalen per medewerker voor de loonadministratie.
 */
export async function exportPeriodHours(period: RosterPeriod, range: ExportRange): Promise<{ ok: boolean; message?: string }> {
  const res = await fetchApproved(period, range)
  if (!res.ok) return res

  // Aggregeren per medewerker + per week. Gewerkte diensten worden per dag
  // gegroepeerd, zodat de onbetaalde pauze en de middagoverlap per hele
  // dag verrekend worden (zie dayPaidHours).
  const totals = new Map<string, StudentTotals>()
  const weekTotals = new Map<string, { week: number; name: string; weekdayHours: number; saturdayHours: number }>()
  const dayGroups = new Map<string, AssignmentExportRow[]>()

  const totalsFor = (userId: string): StudentTotals => {
    let t = totals.get(userId)
    if (!t) {
      const prof = res.profiles.get(userId)
      t = {
        name: prof?.full_name || prof?.email || 'Onbekend', email: prof?.email || '',
        days: new Set(), shifts: 0, ochtend: 0, middag: 0,
        saturdayShifts: 0, weekdayHours: 0, saturdayHours: 0, pauseHours: 0,
        sick: 0, sickHours: 0, absent: 0, absentHours: 0,
      }
      totals.set(userId, t)
    }
    return t
  }

  for (const row of res.rows) {
    const t = totalsFor(row.user_id)
    const hours = rowHours(row)
    const att = row.attendance || 'gewerkt'
    if (att === 'ziek') { t.sick += 1; t.sickHours += hours; continue }
    if (att === 'afwezig') { t.absent += 1; t.absentHours += hours; continue }

    const shift = row.shifts
    t.days.add(shift.shift_date)
    t.shifts += 1
    if (shift.shift_type === 'ochtend') t.ochtend += 1
    else if (shift.shift_type === 'middag') t.middag += 1
    if (isSaturdayISO(shift.shift_date)) t.saturdayShifts += 1

    const key = `${row.user_id}|${shift.shift_date}`
    if (!dayGroups.has(key)) dayGroups.set(key, [])
    dayGroups.get(key)!.push(row)
  }

  for (const [key, rows] of dayGroups) {
    const [userId, date] = key.split('|')
    const t = totalsFor(userId)
    const { hours, pause } = dayPaidHours(rows)
    const sat = isSaturdayISO(date)
    if (sat) t.saturdayHours += hours
    else t.weekdayHours += hours
    t.pauseHours += pause

    const week = isoWeek(date)
    const wKey = `${week}|${userId}`
    let w = weekTotals.get(wKey)
    if (!w) { w = { week, name: t.name, weekdayHours: 0, saturdayHours: 0 }; weekTotals.set(wKey, w) }
    if (sat) w.saturdayHours += hours
    else w.weekdayHours += hours
  }

  const rows = [...totals.values()].sort((a, b) => a.name.localeCompare(b.name))

  const lines: string[] = []
  lines.push(cell(`Urenexport ${rangeLabel(period, range)}`))
  lines.push('')
  const header = [
    'Naam', 'E-mail', 'Gewerkte dagen', 'Gewerkte diensten', 'Ochtenddiensten', 'Middagdiensten',
    'Zaterdagdiensten', 'Uren doordeweeks', 'Uren zaterdag', 'Pauze-uren (onbetaald)', 'Totaal verloonde uren',
    'Ziek (diensten)', 'Ziek (uren)', 'Afwezig (diensten)', 'Afwezig (uren)',
  ]
  lines.push(header.map(cell).join(';'))
  for (const r of rows) {
    lines.push([
      cell(r.name), cell(r.email), r.days.size, r.shifts, r.ochtend, r.middag,
      r.saturdayShifts, cell(nl(r.weekdayHours)), cell(nl(r.saturdayHours)),
      cell(nl(r.pauseHours)), cell(nl(r.weekdayHours + r.saturdayHours)),
      r.sick, cell(nl(r.sickHours)), r.absent, cell(nl(r.absentHours)),
    ].join(';'))
  }
  const sum = (f: (r: StudentTotals) => number) => rows.reduce((n, r) => n + f(r), 0)
  lines.push([
    cell('TOTAAL'), '', '',
    sum(r => r.shifts), sum(r => r.ochtend), sum(r => r.middag), sum(r => r.saturdayShifts),
    cell(nl(sum(r => r.weekdayHours))), cell(nl(sum(r => r.saturdayHours))),
    cell(nl(sum(r => r.pauseHours))),
    cell(nl(sum(r => r.weekdayHours + r.saturdayHours))),
    sum(r => r.sick), cell(nl(sum(r => r.sickHours))), sum(r => r.absent), cell(nl(sum(r => r.absentHours))),
  ].join(';'))

  // Weektotalen per medewerker (loonweken).
  lines.push('')
  lines.push(cell('Weektotalen'))
  lines.push(['Week', 'Naam', 'Uren doordeweeks', 'Uren zaterdag', 'Totaal uren'].map(cell).join(';'))
  const weekRows = [...weekTotals.values()].sort((a, b) => a.week - b.week || a.name.localeCompare(b.name))
  for (const w of weekRows) {
    lines.push([
      cell(`Week ${w.week}`), cell(w.name),
      cell(nl(w.weekdayHours)), cell(nl(w.saturdayHours)), cell(nl(w.weekdayHours + w.saturdayHours)),
    ].join(';'))
  }

  const monthName = MONTHS_NL[period.month - 1]
  triggerDownload(`uren-${monthName}-${period.year}${rangeSuffix(period, range)}.csv`, lines.join('\r\n'))
  return { ok: true, message: `Export voor ${rangeLabel(period, range)} gedownload.` }
}

/**
 * Detail-export (CSV): één regel per goedgekeurde dienst met datum, dag,
 * medewerker, werktijden, uren, zaterdag-markering en aanwezigheid.
 * Brondata voor controle en boekhouding.
 */
export async function exportPeriodDetails(period: RosterPeriod, range: ExportRange): Promise<{ ok: boolean; message?: string }> {
  const res = await fetchApproved(period, range)
  if (!res.ok) return res

  // Groeperen per dag + medewerker, zodat de pauze- en overlapcorrecties
  // van een hele dag als eigen regels direct onder de diensten staan.
  const groups = new Map<string, AssignmentExportRow[]>()
  for (const row of res.rows) {
    const key = `${row.shifts.shift_date}|${row.user_id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  const groupKeys = [...groups.keys()].sort((a, b) => {
    const [da, ua] = a.split('|'), [db, ub] = b.split('|')
    return da.localeCompare(db) ||
      (res.profiles.get(ua)?.full_name || '').localeCompare(res.profiles.get(ub)?.full_name || '')
  })

  const lines: string[] = []
  lines.push(cell(`Urenexport detail ${rangeLabel(period, range)}`))
  lines.push('')
  lines.push(['Datum', 'Dag', 'Week', 'Zaterdag', 'Naam', 'E-mail', 'Dagdeel', 'Van', 'Tot', 'Uren', 'Aanwezigheid'].map(cell).join(';'))

  let paidTotal = 0
  for (const key of groupKeys) {
    const dayRows = groups.get(key)!.sort((a, b) => a.shifts.shift_type.localeCompare(b.shifts.shift_type))
    const [date] = key.split('|')
    const prof = res.profiles.get(dayRows[0].user_id)
    const weekday = new Date(date + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long' })
    const base = [
      cell(ddmm(date) + '-' + period.year), cell(weekday), cell(`Week ${isoWeek(date)}`),
      cell(isSaturdayISO(date) ? 'ja' : 'nee'),
      cell(prof?.full_name || prof?.email || 'Onbekend'), cell(prof?.email || ''),
    ]

    for (const row of dayRows) {
      const { start, end } = rowTimes(row)
      lines.push([
        ...base, cell(row.shifts.shift_type), cell(start), cell(end),
        cell(nl(rowHours(row))), cell(row.attendance || 'gewerkt'),
      ].join(';'))
    }

    const worked = dayRows.filter(r => (r.attendance || 'gewerkt') === 'gewerkt')
    if (worked.length >= 2) {
      // Hele dag: dubbele overlap en onbetaalde pauze als correctieregels.
      const { hours, pause, overlap } = dayPaidHours(worked)
      if (overlap > 0) {
        lines.push([...base, cell('overlapcorrectie'), '', '', cell(nl(-overlap)), cell('-')].join(';'))
      }
      lines.push([...base, cell('pauze (onbetaald)'), cell(PAUSE_START), cell(PAUSE_END), cell(nl(-pause)), cell('-')].join(';'))
      paidTotal += hours
    } else {
      paidTotal += worked.reduce((n, r) => n + rowHours(r), 0)
    }
  }
  lines.push('')
  lines.push([cell('TOTAAL verloonde uren'), '', '', '', '', '', '', '', '', cell(nl(paidTotal)), ''].join(';'))

  const monthName = MONTHS_NL[period.month - 1]
  triggerDownload(`uren-detail-${monthName}-${period.year}${rangeSuffix(period, range)}.csv`, lines.join('\r\n'))
  return { ok: true, message: `Detail-export voor ${rangeLabel(period, range)} gedownload.` }
}
