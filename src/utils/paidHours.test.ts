import { describe, it, expect } from 'vitest'
import { rowHours, dayPaidHours, DEFAULT_PAUSE, PaidHoursRow } from './paidHours'
import { hoursBetween } from './shiftTimes'
import { isoWeek, isSaturdayISO } from './dates'

// Standaard ADHDMC-diensten zoals ze in de database staan.
function ochtend(custom?: { start: string; end: string }): PaidHoursRow {
  return {
    custom_start_time: custom?.start ?? null,
    custom_end_time: custom?.end ?? null,
    shifts: { start_time: '08:30', end_time: '12:30', duration_hours: 4 },
  }
}

function middag(custom?: { start: string; end: string }): PaidHoursRow {
  return {
    custom_start_time: custom?.start ?? null,
    custom_end_time: custom?.end ?? null,
    shifts: { start_time: '12:00', end_time: '17:30', duration_hours: 5.5 },
  }
}

describe('hoursBetween', () => {
  it('rekent hele en halve uren', () => {
    expect(hoursBetween('08:30', '12:30')).toBe(4)
    expect(hoursBetween('12:00', '17:30')).toBe(5.5)
    expect(hoursBetween('08:00', '17:00')).toBe(9)
  })
})

describe('rowHours', () => {
  it('gebruikt de standaardduur zonder afwijkende tijden', () => {
    expect(rowHours(ochtend())).toBe(4)
    expect(rowHours(middag())).toBe(5.5)
  })

  it('laat afwijkende werktijden voorgaan op de standaardduur', () => {
    expect(rowHours(ochtend({ start: '08:00', end: '12:00' }))).toBe(4)
    expect(rowHours(middag({ start: '12:30', end: '17:30' }))).toBe(5)
  })
})

describe('dayPaidHours — de verloonde-urenberekening', () => {
  it('los dagdeel: geen pauze- of overlap-aftrek', () => {
    expect(dayPaidHours([ochtend()])).toEqual({ hours: 4, pause: 0, overlap: 0 })
    expect(dayPaidHours([middag()])).toEqual({ hours: 5.5, pause: 0, overlap: 0 })
  })

  it('hele dag op standaardtijden: dubbele overlap (12:00–12:30) én pauze eraf → 8,5u', () => {
    const r = dayPaidHours([ochtend(), middag()])
    expect(r.overlap).toBe(0.5)
    expect(r.pause).toBe(0.5)
    expect(r.hours).toBe(8.5)
  })

  it('vroege dag (08:00–12:00 + 12:00–17:00): aansluitend, alleen pauze eraf → 8,5u', () => {
    const r = dayPaidHours([
      ochtend({ start: '08:00', end: '12:00' }),
      middag({ start: '12:00', end: '17:00' }),
    ])
    expect(r.overlap).toBe(0)
    expect(r.hours).toBe(8.5)
  })

  it('late dag (08:30–12:30 + 12:30–17:30): aansluitend, alleen pauze eraf → 8,5u', () => {
    const r = dayPaidHours([
      ochtend({ start: '08:30', end: '12:30' }),
      middag({ start: '12:30', end: '17:30' }),
    ])
    expect(r.overlap).toBe(0)
    expect(r.hours).toBe(8.5)
  })

  it('pauze uitgeschakeld: alleen de overlap wordt verrekend', () => {
    const r = dayPaidHours([ochtend(), middag()], { ...DEFAULT_PAUSE, enabled: false })
    expect(r.pause).toBe(0)
    expect(r.hours).toBe(9)
  })

  it('afwijkende pauzeduur (60 min) wordt gebruikt', () => {
    const r = dayPaidHours([ochtend(), middag()], { enabled: true, start: '12:00', end: '13:00', hours: 1 })
    expect(r.pause).toBe(1)
    expect(r.hours).toBe(8)
  })
})

describe('dag-helpers', () => {
  it('isSaturdayISO herkent zaterdagen', () => {
    expect(isSaturdayISO('2026-08-15')).toBe(true)   // zaterdag
    expect(isSaturdayISO('2026-08-16')).toBe(false)  // zondag
    expect(isSaturdayISO('2026-08-17')).toBe(false)  // maandag
  })

  it('isoWeek volgt de ISO-weeknummering (loonweken)', () => {
    expect(isoWeek('2026-01-01')).toBe(1)   // donderdag → week 1
    expect(isoWeek('2024-01-01')).toBe(1)   // maandag → week 1
    expect(isoWeek('2023-01-01')).toBe(52)  // zondag → hoort bij week 52 van 2022
    expect(isoWeek('2026-12-28')).toBe(53)  // 2026 heeft 53 ISO-weken
  })
})
