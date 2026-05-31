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

// Maandag t/m zaterdag (alleen zondag uitgesloten).
export function getRosterDaysInMonth(year: number, month: number): Date[] {
  const start = startOfMonth(new Date(year, month - 1))
  const end = endOfMonth(new Date(year, month - 1))
  return eachDayOfInterval({ start, end }).filter(d => d.getDay() !== 0)
}

export function isSaturday(date: Date): boolean {
  return date.getDay() === 6
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

export function getWeeksInMonth(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)

  // Start from the Monday of the first week
  const weekStart = new Date(firstDay)
  const dow = weekStart.getDay()
  weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1))

  const result: (Date | null)[][] = []
  while (weekStart <= lastDay) {
    const week: (Date | null)[] = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      week.push(d.getMonth() === month - 1 ? d : null)
    }
    result.push(week)
    weekStart.setDate(weekStart.getDate() + 7)
  }
  return result
}
