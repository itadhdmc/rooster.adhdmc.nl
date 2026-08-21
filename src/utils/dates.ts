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

// Alle dagen van een maand die op de gegeven ISO-weekdagen (1=ma..7=zo)
// vallen — de generieke opvolger van getWorkdays/getRosterDays.
export function daysForWeekdays(year: number, month: number, weekdays: number[]): Date[] {
  const start = startOfMonth(new Date(year, month - 1))
  const end = endOfMonth(new Date(year, month - 1))
  return eachDayOfInterval({ start, end }).filter(d => weekdays.includes(d.getDay() === 0 ? 7 : d.getDay()))
}

export function isSaturday(date: Date): boolean {
  return date.getDay() === 6
}

// Woensdag (3) en zaterdag (6) zijn altijd voor maar 1 student.
export function isSingleStudentDay(date: Date): boolean {
  const d = date.getDay()
  return d === 3 || d === 6
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

// ISO-weeknummer van een ISO-datumstring (loonweken).
export function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
}

export function isSaturdayISO(dateStr: string): boolean {
  return new Date(dateStr + 'T00:00:00').getDay() === 6
}
