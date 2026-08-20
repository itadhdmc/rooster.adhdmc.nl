import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useSettings, shiftTypeConfig } from '../hooks/useSettings'
import { supabase } from '../lib/supabase'
import { RosterPeriod, Shift, AssignmentWithShiftJoin } from '../types'
import { monthLabel, formatDate } from '../utils/dates'
import { effectiveShift } from '../utils/shiftTimes'

interface UpcomingShift {
  shift: Shift
  shiftId: string
}

export default function Dashboard() {
  const { profile, loading: authLoading } = useAuth()
  const { settings } = useSettings()
  const [activePeriod, setActivePeriod] = useState<RosterPeriod | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [reserveCount, setReserveCount] = useState(0)
  const [upcomingShifts, setUpcomingShifts] = useState<UpcomingShift[]>([])
  const [nextMates, setNextMates] = useState<string[]>([])
  const [availableCount, setAvailableCount] = useState(0)
  const [weekHours, setWeekHours] = useState(0)
  const [monthHours, setMonthHours] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!profile) { setLoading(false); return }
    loadDashboard()
  }, [profile, authLoading])

  async function loadDashboard() {
    try {
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const todayISO = today.toISOString().split('T')[0]

      const [{ data: periods }, { data: assignmentRows }] = await Promise.all([
        supabase.from('roster_periods').select('*').order('year').order('month'),
        supabase.from('assignments').select('*, shifts(*)').eq('user_id', profile!.id),
      ])
      const assignments = (assignmentRows || []) as AssignmentWithShiftJoin[]

      const openPeriod = (periods || []).find(p => p.availability_open || p.second_round_open) || null
      setActivePeriod(openPeriod)

      setPendingCount(assignments.filter(a => a.status === 'pending').length)
      setReserveCount(assignments.filter(a =>
        a.status === 'reserve' && a.shifts && a.shifts.shift_date >= todayISO).length)

      // Aankomende goedgekeurde diensten (met afwijkende tijden verwerkt).
      const upcoming = assignments
        .filter(a => a.shifts && a.shifts.shift_date >= todayISO && a.status === 'approved')
        .sort((a, b) => a.shifts!.shift_date.localeCompare(b.shifts!.shift_date)
          || a.shifts!.start_time.localeCompare(b.shifts!.start_time))
        .map(a => ({ shift: effectiveShift(a.shifts!, a), shiftId: a.shift_id }))
      setUpcomingShifts(upcoming)

      // Wie werkt er mee op de eerstvolgende dienst?
      if (upcoming.length > 0) {
        const { data: mates } = await supabase
          .from('shifts_with_assignments')
          .select('assigned_students')
          .eq('id', upcoming[0].shiftId)
          .maybeSingle()
        setNextMates(((mates?.assigned_students || []) as { status: string; user_id: string; full_name: string; email: string }[])
          .filter(s => s.status === 'approved' && s.user_id !== profile!.id)
          .map(s => (s.full_name || s.email).split(' ')[0]))
      } else {
        setNextMates([])
      }

      // Hoeveel diensten kun je nog aanmelden in de open periode?
      if (openPeriod) {
        const { data: open } = await supabase
          .from('shifts_with_assignments')
          .select('id, open_spots, shift_date')
          .eq('period_id', openPeriod.id)
          .gt('open_spots', 0)
          .gte('shift_date', todayISO)
        const mine = new Set(assignments.map(a => a.shift_id))
        setAvailableCount((open || []).filter(s => !mine.has(s.id)).length)
      } else {
        setAvailableCount(0)
      }

      // Uren: deze kalenderweek (ma–zo) en deze maand.
      const dow = today.getDay()
      const monday = new Date(today); monday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow))
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
      let wh = 0, mh = 0
      for (const a of assignments) {
        if (a.status !== 'approved' || !a.shifts) continue
        const shift = effectiveShift(a.shifts, a)
        const d = new Date(shift.shift_date + 'T00:00:00')
        if (d >= monday && d <= sunday) wh += Number(shift.duration_hours)
        if (d.getFullYear() === year && d.getMonth() + 1 === month) mh += Number(shift.duration_hours)
      }
      setWeekHours(wh)
      setMonthHours(mh)
    } catch (err) {
      console.error('Dashboard fout:', err)
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || loading) return <Spinner />

  if (!profile) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Profiel niet gevonden. Probeer opnieuw in te loggen.</p>
      </div>
    )
  }

  const next = upcomingShifts[0]
  const weekMin = Number(profile.contract_min_hours)
  const weekMax = Number(profile.contract_max_hours)
  const monthMax = Math.round(weekMax * settings.monthly_cap_factor * 10) / 10
  const nl = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-dark">
          Hallo, {profile.full_name?.split(' ')[0] || 'daar'}
        </h1>
        <p className="text-gray-400 text-sm mt-0.5 capitalize">
          {new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Hero: je volgende dienst */}
      {next ? (
        <div className="rounded-xl p-6 text-white" style={{ backgroundColor: 'var(--color-dark)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Je volgende dienst</p>
          <p className="text-xl font-semibold mt-2 capitalize">{formatDate(next.shift.shift_date)}</p>
          <p className="text-white/70 text-sm mt-1">
            {next.shift.start_time.slice(0, 5)} – {next.shift.end_time.slice(0, 5)}
            {' · '}{shiftTypeConfig(settings, next.shift.shift_type).label}dienst
            {nextMates.length > 0 && <> · Met {nextMates.join(' en ')}</>}
          </p>
          <Link to="/mijn-rooster" className="inline-block mt-4 text-sm font-semibold text-white/90 hover:text-white border border-white/25 hover:border-white/50 px-4 py-2 rounded-xl transition-colors">
            Bekijk je rooster →
          </Link>
        </div>
      ) : (
        <div className="rounded-xl p-6 text-white" style={{ backgroundColor: 'var(--color-dark)' }}>
          <p className="text-xl font-semibold">Je hebt nog geen dienst ingepland</p>
          <p className="text-white/60 text-sm mt-1">
            {availableCount > 0
              ? `Er ${availableCount === 1 ? 'is 1 dienst' : `zijn ${availableCount} diensten`} waarvoor je je kunt aanmelden.`
              : activePeriod
              ? 'Alle beschikbare diensten zijn op dit moment gevuld.'
              : 'Er is momenteel geen open inschrijving.'}
          </p>
          {availableCount > 0 && (
            <Link to="/beschikbaarheid" className="inline-block mt-4 text-sm font-bold px-4 py-2 rounded-xl text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              Bekijk beschikbare diensten →
            </Link>
          )}
        </div>
      )}

      {/* Uren: begrijpelijk, met context */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card p-5">
          <p className="text-sm font-semibold text-dark">Deze week</p>
          <p className="text-[13px] text-gray-400 mt-0.5">
            <span className="font-semibold text-dark">{nl(weekHours)}</span> van {weekMin}–{weekMax} contracturen ingepland
          </p>
          <ProgressBar value={weekHours} max={weekMax} marker={weekMin} />
        </div>
        <div className="card p-5">
          <p className="text-sm font-semibold text-dark">Deze maand</p>
          <p className="text-[13px] text-gray-400 mt-0.5">
            <span className="font-semibold text-dark">{nl(monthHours)}</span> uur ingepland
            {monthHours < monthMax && <> · nog {nl(monthMax - monthHours)} uur mogelijk</>}
          </p>
          <ProgressBar value={monthHours} max={monthMax} />
        </div>
      </div>

      {/* Open inschrijving */}
      {activePeriod && (
        <div className="card px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-dark capitalize">
              {monthLabel(activePeriod.year, activePeriod.month)}-inschrijving is geopend
            </p>
            <p className="text-[13px] text-gray-400 mt-0.5">
              {availableCount > 0 ? `Nog ${availableCount} dienst${availableCount !== 1 ? 'en' : ''} beschikbaar` : 'Alle diensten zijn gevuld'}
              {activePeriod.availability_deadline && (
                <> · sluit op {new Date(activePeriod.availability_deadline).toLocaleDateString('nl-NL', {
                  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                })}</>
              )}
            </p>
          </div>
          <Link to="/beschikbaarheid" className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--color-primary)' }}>
            Diensten bekijken →
          </Link>
        </div>
      )}

      {/* Aandacht nodig */}
      {(pendingCount > 0 || reserveCount > 0) && (
        <div className="card divide-y divide-gray-50">
          {pendingCount > 0 && (
            <Link to="/mijn-rooster" className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
              <div>
                <p className="text-sm font-medium text-dark">
                  {pendingCount} aanmelding{pendingCount !== 1 ? 'en' : ''} wacht{pendingCount === 1 ? '' : 'en'} op goedkeuring
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Je hoort het zodra de planning ze beoordeelt.</p>
              </div>
              <span className="text-gray-300">→</span>
            </Link>
          )}
          {reserveCount > 0 && (
            <Link to="/mijn-rooster" className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
              <div>
                <p className="text-sm font-medium text-dark">
                  Je staat op de reservelijst voor {reserveCount} dienst{reserveCount !== 1 ? 'en' : ''}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Word je ingepland, dan krijg je een melding en e-mail.</p>
              </div>
              <span className="text-gray-300">→</span>
            </Link>
          )}
        </div>
      )}

      {/* Aankomende diensten */}
      {upcomingShifts.length > 1 && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="font-semibold text-dark text-sm">Daarna</h2>
            <Link to="/mijn-rooster" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              Alles bekijken →
            </Link>
          </div>
          <div className="card overflow-hidden divide-y divide-gray-50">
            {upcomingShifts.slice(1, 5).map(({ shift }) => (
              <div key={shift.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-dark capitalize text-sm">{formatDate(shift.shift_date)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} · {String(shift.duration_hours).replace('.', ',')}u
                  </p>
                </div>
                <span className="text-xs font-medium text-gray-400 capitalize">
                  {shiftTypeConfig(settings, shift.shift_type).label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProgressBar({ value, max, marker }: { value: number; max: number; marker?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const markerPct = marker && max > 0 ? Math.min(100, (marker / max) * 100) : null
  return (
    <div className="relative h-1.5 bg-gray-100 rounded-full mt-3 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: 'var(--color-primary)' }} />
      {markerPct !== null && markerPct > 0 && markerPct < 100 && (
        <div className="absolute inset-y-0 w-0.5 bg-gray-300" style={{ left: `${markerPct}%` }} title={`Contractminimum: ${marker}u`} />
      )}
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
