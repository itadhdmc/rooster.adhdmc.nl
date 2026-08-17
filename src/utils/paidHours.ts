import { hoursBetween } from './shiftTimes'

// Onbetaalde pauze voor wie de hele dag werkt (beide dagdelen).
// Losse dagdelen krijgen geen aftrek: de middagploeg vangt juist de
// pauze van de dagwerkers op (daarvoor bestaat de middagoverlap).
export const PAUSE_START = '12:00'
export const PAUSE_END = '12:30'
export const PAUSE_HOURS = 0.5

// Minimale vorm van een toewijzing + dienst die nodig is om verloonde
// uren te berekenen (export én Inzichten gebruiken deze berekening).
export interface PaidHoursRow {
  custom_start_time: string | null
  custom_end_time: string | null
  shifts: {
    start_time: string
    end_time: string
    duration_hours: number
  }
}

// Werkelijke uren van één toewijzing: afwijkende werktijden gaan vóór
// de standaardduur van de dienst.
export function rowHours(row: PaidHoursRow): number {
  return row.custom_start_time && row.custom_end_time
    ? hoursBetween(row.custom_start_time, row.custom_end_time)
    : Number(row.shifts.duration_hours)
}

export function rowTimes(row: PaidHoursRow): { start: string; end: string } {
  return {
    start: (row.custom_start_time || row.shifts.start_time).slice(0, 5),
    end: (row.custom_end_time || row.shifts.end_time).slice(0, 5),
  }
}

// Overlap (in uren) tussen twee gewerkte blokken op dezelfde dag, op basis
// van de effectieve tijden. Bij de standaardtijden is dat 12:00–12:30;
// die tijd mag niet dubbel verloond worden.
function overlapHours(a: PaidHoursRow, b: PaidHoursRow): number {
  const ta = rowTimes(a), tb = rowTimes(b)
  const start = ta.start > tb.start ? ta.start : tb.start
  const end = ta.end < tb.end ? ta.end : tb.end
  return end > start ? hoursBetween(start, end) : 0
}

// Verloonde uren van één dag: som van de blokken, minus dubbele overlap,
// en bij een hele dag (2+ blokken) minus de onbetaalde pauze.
export function dayPaidHours(rows: PaidHoursRow[]): { hours: number; pause: number; overlap: number } {
  const gross = rows.reduce((n, r) => n + rowHours(r), 0)
  if (rows.length < 2) return { hours: gross, pause: 0, overlap: 0 }
  let overlap = 0
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++)
      overlap += overlapHours(rows[i], rows[j])
  return { hours: gross - overlap - PAUSE_HOURS, pause: PAUSE_HOURS, overlap }
}
