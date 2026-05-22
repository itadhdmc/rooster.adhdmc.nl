import { format, parseISO, getDaysInMonth, eachDayOfInterval, startOfMonth, endOfMonth, isWeekend } from 'date-fns'
import { nl } from 'date-fns/locale'

export const MONTHS_NL = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'
]

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'EEEE d MMMM', { locale: nl })
}

export function formatShortDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd-MM-yyyy')
}

export function getWorkdaysInMonth(year: number, month: number): Date[] {
  const start = startOfMonth(new Date(year, month - 1))
  const end = endOfMonth(new Date(year, month - 1))
  return eachDayOfInterval({ start, end }).filter(d => !isWeekend(d))
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS_NL[month - 1]} ${year}`
}

export function daysInMonth(year: number, month: number): number {
  return getDaysInMonth(new Date(year, month - 1))
}

export function dateToISO(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}
