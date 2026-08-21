import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { RosterPeriod, Profile, ShiftWithAssignments } from '../../types'
import { monthLabel, formatDate } from '../../utils/dates'
import { rowHours, dayPaidHours } from '../../utils/paidHours'
import { useSettings, pauseConfig } from '../../hooks/useSettings'

// Assignment-rij zoals de inzichten-query die teruggeeft (met geneste dienst).
interface InsightAssignmentRow {
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

interface StudentRow {
  profile: Profile
  hours: number
  shifts: number
  sick: number
  absent: number
}

export default function Inzichten() {
  const { settings } = useSettings()
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null)
  const [shifts, setShifts] = useState<ShiftWithAssignments[]>([])
  const [students, setStudents] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingPeriod, setLoadingPeriod] = useState(false)

  useEffect(() => { loadPeriods() }, [])
  useEffect(() => { if (selectedPeriod) loadPeriodData() }, [selectedPeriod?.id])

  async function loadPeriods() {
    const { data } = await supabase
      .from('roster_periods').select('*').order('year').order('month')
    const all = data || []
    setPeriods(all)
    const now = new Date()
    const current = all.find(p => p.year === now.getFullYear() && p.month === now.getMonth() + 1)
    setSelectedPeriod(current || all[all.length - 1] || null)
    setLoading(false)
  }

  async function loadPeriodData() {
    if (!selectedPeriod) return
    setLoadingPeriod(true)
    const [{ data: s }, { data: a }, { data: p }] = await Promise.all([
      supabase.from('shifts_with_assignments')
        .select('*')
        .eq('period_id', selectedPeriod.id)
        .order('shift_date').order('start_time'),
      supabase.from('assignments')
        .select('user_id, attendance, custom_start_time, custom_end_time, shifts!inner(shift_date, shift_type, start_time, end_time, duration_hours, period_id)')
        .eq('status', 'approved')
        .eq('shifts.period_id', selectedPeriod.id),
      supabase.from('profiles')
        .select('*')
        .eq('role', 'student').eq('active', true)
        .order('full_name'),
    ])
    setShifts(s || [])

    // Verloonde uren, ziekte en afwezigheid per medewerker. Zelfde
    // berekening als de urenexport: gewerkte diensten per dag groeperen,
    // zodat pauze en middagoverlap van hele dagen verrekend worden.
    const totals = new Map<string, { hours: number; shifts: number; sick: number; absent: number }>()
    const dayGroups = new Map<string, InsightAssignmentRow[]>()
    for (const row of (a || []) as unknown as InsightAssignmentRow[]) {
      let t = totals.get(row.user_id)
      if (!t) { t = { hours: 0, shifts: 0, sick: 0, absent: 0 }; totals.set(row.user_id, t) }
      const att = row.attendance || 'gewerkt'
      if (att === 'ziek') { t.sick += 1; continue }
      if (att === 'afwezig') { t.absent += 1; continue }
      t.shifts += 1
      const key = `${row.user_id}|${row.shifts.shift_date}`
      if (!dayGroups.has(key)) dayGroups.set(key, [])
      dayGroups.get(key)!.push(row)
    }
    const pause = pauseConfig(settings)
    for (const [key, dayRows] of dayGroups) {
      const userId = key.split('|')[0]
      totals.get(userId)!.hours += dayRows.length > 1 ? dayPaidHours(dayRows, pause).hours : rowHours(dayRows[0])
    }
    const rows = ((p || []) as Profile[]).map(profile => ({
      profile,
      ...(totals.get(profile.id) || { hours: 0, shifts: 0, sick: 0, absent: 0 }),
    }))
    rows.sort((x, y) => y.hours - x.hours || (x.profile.full_name || '').localeCompare(y.profile.full_name || ''))
    setStudents(rows)
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

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const openShifts = shifts.filter(s => s.open_spots > 0)
  const reservesFor = (s: ShiftWithAssignments) =>
    (s.assigned_students || []).filter(st => st.status === 'reserve')
  const totalHours = students.reduce((n, r) => n + r.hours, 0)
  const totalSick = students.reduce((n, r) => n + r.sick, 0)
  const totalReserves = shifts.reduce((n, s) => n + reservesFor(s).length, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/admin" className="text-xs text-gray-400 hover:text-dark transition-colors font-medium">
            ← Beheerpaneel
          </Link>
          <h1 className="text-2xl font-bold text-dark mt-1">Inzichten</h1>
          <p className="text-gray-400 text-sm mt-0.5">Bezetting, uren en aanwezigheid per maand.</p>
        </div>
        <select
          className="border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-medium text-dark focus:outline-none"
          value={selectedPeriod.id}
          onChange={e => setSelectedPeriod(periods.find(p => p.id === e.target.value) || null)}
        >
          {periods.map(p => <option key={p.id} value={p.id}>{monthLabel(p.year, p.month)}</option>)}
        </select>
      </div>

      {loadingPeriod ? <Spinner /> : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Verloonde uren" value={`${round1(totalHours)}u`} color="text-dark" />
            <StatCard label="Open plekken" value={String(openShifts.reduce((n, s) => n + s.open_spots, 0))}
              color={openShifts.length > 0 ? 'text-amber-600' : 'text-emerald-600'} />
            <StatCard label="Op reservelijst" value={String(totalReserves)} color="text-sky-600" />
            <StatCard label="Ziekmeldingen" value={String(totalSick)} color={totalSick > 0 ? 'text-rose-500' : 'text-dark'} />
          </div>

          {/* Bezettingsradar */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full ${openShifts.length > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              <h2 className="font-bold text-dark text-sm">Diensten met open plekken</h2>
              {openShifts.length > 0 && (
                <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  {openShifts.length}
                </span>
              )}
            </div>
            {openShifts.length === 0 ? (
              <p className="px-5 py-8 text-sm text-gray-400 text-center">
                Alle diensten in {monthLabel(selectedPeriod.year, selectedPeriod.month)} zijn volledig gevuld.
              </p>
            ) : (
              <div className="divide-y divide-gray-50">
                {openShifts.map(s => {
                  const reserves = reservesFor(s)
                  const isPast = new Date(s.shift_date + 'T00:00:00') < today
                  return (
                    <div key={s.id} className={`px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap ${isPast ? 'opacity-45' : ''}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                          s.shift_type === 'ochtend' ? 'bg-orange-50 text-orange-500' : 'bg-indigo-50 text-indigo-500'
                        }`}>
                          {s.shift_type === 'ochtend' ? 'Ochtend' : 'Middag'}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-dark capitalize truncate">{formatDate(s.shift_date)}</p>
                          <p className="text-xs text-gray-400">
                            {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)} · {s.open_spots} plek{s.open_spots !== 1 ? 'ken' : ''} open
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {reserves.length > 0 ? (
                          <span
                            className="text-xs font-semibold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-full"
                            title={reserves.map(r => r.full_name || r.email).join(', ')}
                          >
                            {reserves.length} reserve{reserves.length !== 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-gray-300 px-2.5 py-1">geen reserve</span>
                        )}
                        <Link to={`/admin/rooster/${selectedPeriod.id}`}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors">
                          Naar rooster
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Uren en aanwezigheid per medewerker */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h2 className="font-bold text-dark text-sm">Uren en aanwezigheid per medewerker</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Verloonde uren t.o.v. het maandcontract
                {settings.pause_enabled && ` — de onbetaalde pauze (${settings.pause_start}–${settings.pause_end}) van hele dagen is al afgetrokken, net als in de urenexport`}.
                Ziek en afwezig tellen niet mee.
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              {students.map(({ profile, hours, shifts: shiftCount, sick, absent }) => {
                const min = Number(profile.contract_min_hours)
                const max = Number(profile.contract_max_hours)
                const pct = max > 0 ? Math.min(100, (hours / max) * 100) : 0
                const minPct = max > 0 ? Math.min(100, (min / max) * 100) : 0
                const barColor = hours > max ? '#f43f5e' : hours >= min ? '#34d399' : '#fbbf24'
                return (
                  <div key={profile.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-sm font-semibold text-dark truncate">{profile.full_name || profile.email}</p>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-dark">{round1(hours)}u</span>
                        <span className="text-gray-300">/ {min}–{max}u</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-400">{shiftCount} dienst{shiftCount !== 1 ? 'en' : ''}</span>
                        {sick > 0 && <span className="font-semibold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">{sick}× ziek</span>}
                        {absent > 0 && <span className="font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{absent}× afwezig</span>}
                      </div>
                    </div>
                    {/* Urenbalk met contract-min-markering */}
                    <div className="relative h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: barColor }} />
                      {minPct > 0 && minPct < 100 && (
                        <div className="absolute inset-y-0 w-0.5 bg-gray-300" style={{ left: `${minPct}%` }} title={`Contractminimum: ${min}u`} />
                      )}
                    </div>
                  </div>
                )
              })}
              {students.length === 0 && (
                <p className="px-5 py-8 text-sm text-gray-400 text-center">Geen actieve medewerkers gevonden.</p>
              )}
            </div>
          </div>

          {/* Legenda */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#fbbf24' }} /> Onder contractminimum</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#34d399' }} /> Binnen contract</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#f43f5e' }} /> Boven contractmaximum</span>
            <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-gray-300 inline-block" /> Contractminimum</span>
          </div>
        </>
      )}
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card p-4">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
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
