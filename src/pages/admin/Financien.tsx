import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { RosterPeriod, Profile } from '../../types'
import { monthLabel, isoWeek } from '../../utils/dates'
import { rowHours, dayPaidHours } from '../../utils/paidHours'
import { useSettings, pauseConfig, isPremiumDate } from '../../hooks/useSettings'
import ExportDialog from '../../components/ExportDialog'

// Assignment-rij zoals de query die teruggeeft (met geneste dienst).
interface FinRow {
  user_id: string
  attendance: string | null
  custom_start_time: string | null
  custom_end_time: string | null
  shifts: {
    shift_date: string
    shift_type: string
    start_time: string
    end_time: string
    duration_hours: number
    period_id: string
  }
}

interface StudentFin {
  profile: Profile
  weekdayHours: number
  saturdayHours: number
  pauseHours: number
  shifts: number
  saturdayShifts: number
  sickHours: number
  absentHours: number
}

interface WeekFin {
  week: number
  weekdayHours: number
  saturdayHours: number
}

export default function Financien() {
  const { settings } = useSettings()
  const [searchParams] = useSearchParams()
  const kleurWeek = settings.color_dark
  const kleurToeslag = settings.color_primary
  const toeslagLabel = settings.premium_label
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null)
  const [students, setStudents] = useState<StudentFin[]>([])
  const [weeks, setWeeks] = useState<WeekFin[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingPeriod, setLoadingPeriod] = useState(false)
  const [showExport, setShowExport] = useState(false)

  useEffect(() => { loadPeriods() }, [])
  useEffect(() => { if (selectedPeriod) loadPeriodData() }, [selectedPeriod?.id])

  async function loadPeriods() {
    const { data } = await supabase.from('roster_periods').select('*').order('year').order('month')
    const all = data || []
    setPeriods(all)
    const wanted = all.find(p => p.id === searchParams.get('periode'))
    const now = new Date()
    const current = all.find(p => p.year === now.getFullYear() && p.month === now.getMonth() + 1)
    setSelectedPeriod(wanted || current || all[all.length - 1] || null)
    setLoading(false)
  }

  async function loadPeriodData() {
    if (!selectedPeriod) return
    setLoadingPeriod(true)
    const [{ data: a }, { data: p }] = await Promise.all([
      supabase.from('assignments')
        .select('user_id, attendance, custom_start_time, custom_end_time, shifts!inner(shift_date, shift_type, start_time, end_time, duration_hours, period_id)')
        .eq('status', 'approved')
        .eq('shifts.period_id', selectedPeriod.id),
      supabase.from('profiles').select('*').eq('role', 'student').eq('active', true).order('full_name'),
    ])

    // Zelfde berekening als de urenexport: gewerkte diensten per dag
    // groeperen zodat pauze en middagoverlap verrekend worden.
    const totals = new Map<string, Omit<StudentFin, 'profile'>>()
    const dayGroups = new Map<string, FinRow[]>()
    const weekMap = new Map<number, WeekFin>()

    const totalsFor = (userId: string) => {
      let t = totals.get(userId)
      if (!t) {
        t = { weekdayHours: 0, saturdayHours: 0, pauseHours: 0, shifts: 0, saturdayShifts: 0, sickHours: 0, absentHours: 0 }
        totals.set(userId, t)
      }
      return t
    }

    for (const row of (a || []) as unknown as FinRow[]) {
      const t = totalsFor(row.user_id)
      const att = row.attendance || 'gewerkt'
      const hours = rowHours(row)
      if (att === 'ziek') { t.sickHours += hours; continue }
      if (att === 'afwezig') { t.absentHours += hours; continue }
      t.shifts += 1
      if (isPremiumDate(settings, row.shifts.shift_date)) t.saturdayShifts += 1
      const key = `${row.user_id}|${row.shifts.shift_date}`
      if (!dayGroups.has(key)) dayGroups.set(key, [])
      dayGroups.get(key)!.push(row)
    }

    for (const [key, dayRows] of dayGroups) {
      const [userId, date] = key.split('|')
      const t = totalsFor(userId)
      const { hours, pause } = dayRows.length > 1 ? dayPaidHours(dayRows, pauseConfig(settings)) : { hours: rowHours(dayRows[0]), pause: 0 }
      const sat = isPremiumDate(settings, date)
      if (sat) t.saturdayHours += hours
      else t.weekdayHours += hours
      t.pauseHours += pause

      const week = isoWeek(date)
      let w = weekMap.get(week)
      if (!w) { w = { week, weekdayHours: 0, saturdayHours: 0 }; weekMap.set(week, w) }
      if (sat) w.saturdayHours += hours
      else w.weekdayHours += hours
    }

    const rows = ((p || []) as Profile[])
      .map(profile => ({
        profile,
        ...(totals.get(profile.id) || { weekdayHours: 0, saturdayHours: 0, pauseHours: 0, shifts: 0, saturdayShifts: 0, sickHours: 0, absentHours: 0 }),
      }))
      .filter(r => r.shifts > 0 || r.sickHours > 0 || r.absentHours > 0)
      .sort((x, y) => (y.weekdayHours + y.saturdayHours) - (x.weekdayHours + x.saturdayHours))
    setStudents(rows)
    setWeeks([...weekMap.values()].sort((a, b) => a.week - b.week))
    setLoadingPeriod(false)
  }

  if (loading) return <Spinner />

  if (!selectedPeriod) {
    return (
      <div className="card p-16 text-center">
        <h2 className="text-lg font-bold text-dark">Nog geen periodes</h2>
        <p className="text-gray-400 text-sm mt-2">Maak eerst een roosterperiode aan.</p>
      </div>
    )
  }

  const totalWeekday = students.reduce((n, r) => n + r.weekdayHours, 0)
  const totalSaturday = students.reduce((n, r) => n + r.saturdayHours, 0)
  const totalPause = students.reduce((n, r) => n + r.pauseHours, 0)
  const totalSick = students.reduce((n, r) => n + r.sickHours, 0)
  const maxWeek = Math.max(1, ...weeks.map(w => w.weekdayHours + w.saturdayHours))
  const maxStudent = Math.max(1, ...students.map(r => r.weekdayHours + r.saturdayHours))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/admin" className="text-xs text-gray-400 hover:text-dark transition-colors font-medium">
            ← Beheerpaneel
          </Link>
          <h1 className="text-2xl font-bold text-dark mt-1">Financieel</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Verloonde uren — dezelfde berekening als de urenexport (pauze en overlap verrekend).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            className="border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-medium text-dark focus:outline-none"
            value={selectedPeriod.id}
            onChange={e => setSelectedPeriod(periods.find(p => p.id === e.target.value) || null)}
          >
            {periods.map(p => <option key={p.id} value={p.id}>{monthLabel(p.year, p.month)}</option>)}
          </select>
          <button
            onClick={() => setShowExport(true)}
            className="text-sm font-semibold text-white px-4 py-2 rounded-xl transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Uren exporteren
          </button>
        </div>
      </div>

      {showExport && selectedPeriod && (
        <ExportDialog period={selectedPeriod} onClose={() => setShowExport(false)} />
      )}

      {loadingPeriod ? <Spinner /> : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Totaal verloonde uren" value={`${nl1(totalWeekday + totalSaturday)}u`} color="text-dark" />
            <StatCard label={`Waarvan ${toeslagLabel} (toeslag)`} value={`${nl1(totalSaturday)}u`} color="text-salmon-500" accentColor={kleurToeslag} />
            <StatCard label="Pauze-uren afgetrokken" value={`−${nl1(totalPause)}u`} color="text-gray-500" />
            <StatCard label="Ziekte-uren" value={`${nl1(totalSick)}u`} color={totalSick > 0 ? 'text-rose-500' : 'text-dark'} />
          </div>

          {students.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-gray-400 text-sm font-medium">
                Geen goedgekeurde diensten in {monthLabel(selectedPeriod.year, selectedPeriod.month)}.
              </p>
            </div>
          ) : (
            <>
              <div className="grid xl:grid-cols-2 gap-5 items-start">
              {/* Grafiek: uren per week */}
              <div className="card p-5">
                <h2 className="font-bold text-dark text-sm mb-1">Verloonde uren per week</h2>
                <p className="text-xs text-gray-400 mb-4">Loonweken (ISO-weeknummers)</p>
                <div className="flex items-end gap-3 sm:gap-6 h-44">
                  {weeks.map(w => {
                    const total = w.weekdayHours + w.saturdayHours
                    return (
                      <div key={w.week} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                        <span className="text-xs font-bold text-dark mb-1">{nl1(total)}u</span>
                        <div className="w-full max-w-[56px] flex flex-col justify-end rounded-t-lg overflow-hidden" style={{ height: `${(total / maxWeek) * 100}%` }}>
                          {w.saturdayHours > 0 && (
                            <div title={`${toeslagLabel}: ${nl1(w.saturdayHours)}u`} style={{ backgroundColor: kleurToeslag, height: `${(w.saturdayHours / total) * 100}%` }} />
                          )}
                          <div title={`Doordeweeks: ${nl1(w.weekdayHours)}u`} style={{ backgroundColor: kleurWeek, height: `${(w.weekdayHours / total) * 100}%` }} />
                        </div>
                        <span className="text-[10px] font-semibold text-gray-400 mt-1.5">Wk {w.week}</span>
                      </div>
                    )
                  })}
                </div>
                <Legenda week={kleurWeek} toeslag={kleurToeslag} label={toeslagLabel} />
              </div>

              {/* Grafiek: uren per medewerker */}
              <div className="card p-5">
                <h2 className="font-bold text-dark text-sm mb-1">Verloonde uren per medewerker</h2>
                <p className="text-xs text-gray-400 mb-4">Gesorteerd op totaal; pauze is al afgetrokken</p>
                <div className="space-y-3">
                  {students.map(r => {
                    const total = r.weekdayHours + r.saturdayHours
                    return (
                      <div key={r.profile.id}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-semibold text-dark truncate">{r.profile.full_name || r.profile.email}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            <span className="font-bold text-dark">{nl1(total)}u</span>
                            {r.saturdayHours > 0 && <> · {toeslagLabel} {nl1(r.saturdayHours)}u</>}
                            {r.pauseHours > 0 && <> · pauze −{nl1(r.pauseHours)}u</>}
                          </span>
                        </div>
                        <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex" style={{ width: '100%' }}>
                          <div title={`Doordeweeks: ${nl1(r.weekdayHours)}u`} style={{ backgroundColor: kleurWeek, width: `${(r.weekdayHours / maxStudent) * 100}%` }} />
                          <div title={`${toeslagLabel}: ${nl1(r.saturdayHours)}u`} style={{ backgroundColor: kleurToeslag, width: `${(r.saturdayHours / maxStudent) * 100}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <Legenda week={kleurWeek} toeslag={kleurToeslag} label={toeslagLabel} />
              </div>

              </div>

              {/* Tabel: zelfde cijfers als de export */}
              <div className="card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <h2 className="font-bold text-dark text-sm">Specificatie per medewerker</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Identiek aan de kolommen in de urenexport (CSV).</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                        <th className="px-5 py-2.5 font-semibold">Naam</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Diensten</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Toeslagdiensten</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Doordeweeks</th>
                        <th className="px-3 py-2.5 font-semibold text-right capitalize">{toeslagLabel}</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Pauze</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Verloond</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Ziek (u)</th>
                        <th className="px-5 py-2.5 font-semibold text-right">Afwezig (u)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {students.map(r => (
                        <tr key={r.profile.id}>
                          <td className="px-5 py-2.5 font-semibold text-dark whitespace-nowrap">{r.profile.full_name || r.profile.email}</td>
                          <td className="px-3 py-2.5 text-right text-gray-500">{r.shifts}</td>
                          <td className="px-3 py-2.5 text-right text-gray-500">{r.saturdayShifts}</td>
                          <td className="px-3 py-2.5 text-right text-gray-500">{nl1(r.weekdayHours)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold" style={{ color: kleurToeslag }}>{nl1(r.saturdayHours)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-400">{r.pauseHours > 0 ? `−${nl1(r.pauseHours)}` : '—'}</td>
                          <td className="px-3 py-2.5 text-right font-bold text-dark">{nl1(r.weekdayHours + r.saturdayHours)}</td>
                          <td className="px-3 py-2.5 text-right text-rose-500">{r.sickHours > 0 ? nl1(r.sickHours) : '—'}</td>
                          <td className="px-5 py-2.5 text-right text-gray-400">{r.absentHours > 0 ? nl1(r.absentHours) : '—'}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 bg-gray-50/60">
                        <td className="px-5 py-2.5 font-bold text-dark">TOTAAL</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-500">{students.reduce((n, r) => n + r.shifts, 0)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-500">{students.reduce((n, r) => n + r.saturdayShifts, 0)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-500">{nl1(totalWeekday)}</td>
                        <td className="px-3 py-2.5 text-right font-bold" style={{ color: kleurToeslag }}>{nl1(totalSaturday)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-400">−{nl1(totalPause)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-dark">{nl1(totalWeekday + totalSaturday)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-rose-500">{nl1(totalSick)}</td>
                        <td className="px-5 py-2.5 text-right font-semibold text-gray-400">{nl1(students.reduce((n, r) => n + r.absentHours, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[11px] text-gray-400">
                {settings.pause_enabled
                  ? `Pauzeregel: wie op één dag beide dagdelen werkt krijgt de onbetaalde pauze (${settings.pause_start}–${settings.pause_end}) afgetrokken; losse dagdelen niet. `
                  : 'Er is geen onbetaalde pauze ingesteld. '}
                De CSV-export (knop "Uren export") gebruikt exact dezelfde berekening.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}

function nl1(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace('.', ',')
}

function Legenda({ week, toeslag, label }: { week: string; toeslag: string; label: string }) {
  return (
    <div className="flex gap-4 text-xs text-gray-400 mt-4">
      <span className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: week }} /> Doordeweeks
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: toeslag }} /> <span className="capitalize">{label}</span> (toeslag)
      </span>
    </div>
  )
}

function StatCard({ label, value, color, accentColor }: { label: string; value: string; color: string; accentColor?: string }) {
  return (
    <div className="card p-4">
      <p className={`text-2xl font-bold ${color}`} style={accentColor ? { color: accentColor } : {}}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
    </div>
  )
}
