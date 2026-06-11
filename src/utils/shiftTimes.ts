import { Shift } from '../types'

// Uren tussen twee tijden in 'HH:MM' of 'HH:MM:SS' formaat.
export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 100) / 100
}

interface HasCustomTimes {
  custom_start_time?: string | null
  custom_end_time?: string | null
}

// Effectieve dienst voor een toewijzing: de afwijkende tijden van de
// medewerker als de admin die heeft ingesteld, anders de standaarddienst.
// Ook de duur wordt dan herrekend.
export function effectiveShift(shift: Shift, assignment: HasCustomTimes): Shift {
  if (!assignment.custom_start_time || !assignment.custom_end_time) return shift
  return {
    ...shift,
    start_time: assignment.custom_start_time,
    end_time: assignment.custom_end_time,
    duration_hours: hoursBetween(assignment.custom_start_time, assignment.custom_end_time),
  }
}
