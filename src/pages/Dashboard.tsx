import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useSettings, shiftTypeConfig } from '../hooks/useSettings'
import { supabase } from '../lib/supabase'
import { RosterPeriod, Shift, AssignmentWithShiftJoin } from '../types'
import { monthLabel, formatDate, dateToISO } from '../utils/dates'
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
  const [incomingSwaps, setIncomingSwaps] = useState(0)
  const [upcomingShifts, setUpcomingShifts] = useState<UpcomingShift[]>([])
  const [nextMates, setNextMates] = useState<string[]>([])
  const [availableCount, setAvailableCount] = useState(0)
  const [weekHours, setWeekHours] = useState(0)
  const [monthHours, setMonthHours] = useState(0)
  const [monthShiftCount, setMonthShiftCount] = useState(0)
  // Mijn goedgekeurde diensttypes per dag van de huidige week (ma–zo).
  const [weekMap, setWeekMap] = useState<Record<string, string[]>>({})
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
      const todayISO = dateToISO(today)

      const [{ data: periods }, { data: assignmentRows }, { count: swapCount }] = await Promise.all([
        supabase.from('roster_periods').select('*').order('year').order('month'),
        supabase.from('assignments').select('*, shifts(*)').eq('user_id', profile!.id),
        supabase.from('shift_swaps')
          .select('id', { count: 'exact', head: true })
          .eq('target_user_id', profile!.id)
          .eq('status', 'pending'),
      ])
      const assignments = (assignmentRows || []) as AssignmentWithShiftJoin[]
      setIncomingSwaps(swapCount ?? 0)

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

      // Uren + weekstrip: huidige kalenderweek (ma–zo) en deze maand.
      const dow = today.getDay()
      const monday = new Date(today); monday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow))
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
      let wh = 0, mh = 0, ms = 0
      const wm: Record<string, string[]> = {}
      for (const a of assignments) {
        if (a.status !== 'approved' || !a.shifts) continue
        const shift = effectiveShift(a.shifts, a)
        const d = new Date(shift.shift_date + 'T00:00:00')
        if (d >= monday && d <= sunday) {
          wh += Number(shift.duration_hours)
          if (!wm[shift.shift_date]) wm[shift.shift_date] = []
          wm[shift.shift_date].push(shift.shift_type)
        }
        if (d.getFullYear() === year && d.getMonth() + 1 === month) {
          mh += Number(shift.duration_hours)
          ms += 1
        }
      }
      setWeekHours(wh)
      setMonthHours(mh)
      setMonthShiftCount(ms)
      setWeekMap(wm)
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

  const attention: { label: string; detail: string; to: string }[] = []
  if (incomingSwaps > 0) attention.push({
    label: `${incomingSwaps} ruilverzoek${incomingSwaps !== 1 ? 'en' : ''} wacht${incomingSwaps === 1 ? '' : 'en'} op jou`,
    detail: 'Een collega wil met je ruilen.', to: '/ruilverzoeken',
  })
  if (pendingCount > 0) attention.push({
    label: `${pendingCount} aanmelding${pendingCount !== 1 ? 'en' : ''} in behandeling`,
    detail: 'Je hoort het zodra de planning ze beoordeelt.', to: '/mijn-rooster',
  })
  if (reserveCount > 0) attention.push({
    label: `Reservelijst: ${reserveCount} dienst${reserveCount !== 1 ? 'en' : ''}`,
    detail: 'Word je ingepland, dan krijg je een melding en e-mail.', to: '/mijn-rooster',
  })

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-dark">
          Hallo, {profile.full_name?.split(' ')[0] || 'daar'}
        </h1>
        <p className="text-gray-400 text-sm mt-0.5 capitalize">
          {new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Rij 1: hero + deze week */}
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-5 items-stretch">
        {/* Hero: je volgende dienst */}
        <div className="lg:col-span-2 rounded-2xl p-6 sm:p-7 text-white flex flex-col justify-between min-h-[190px]"
          style={{ backgroundColor: 'var(--color-dark)' }}>
          {next ? (
            <>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Je volgende dienst</p>
                <p className="text-2xl font-semibold mt-2 capitalize">{formatDate(next.shift.shift_date)}</p>
                <p className="text-white/70 text-sm mt-1.5">
                  {next.shift.start_time.slice(0, 5)} – {next.shift.end_time.slice(0, 5)}
                  {' · '}{shiftTypeConfig(settings, next.shift.shift_type).label}dienst
                  {' · '}{String(next.shift.duration_hours).replace('.', ',')}u
                </p>
                {nextMates.length > 0 && (
                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex -space-x-1.5">
                      {nextMates.slice(0, 3).map(name => (
                        <span key={name} className="w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center border-2"
                          style={{ backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-dark)' }}>
                          {name.charAt(0)}
                        </span>
                      ))}
                    </div>
                    <p className="text-white/60 text-xs">Samen met {nextMates.join(' en ')}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-5 flex-wrap">
                <Link to="/mijn-rooster"
                  className="text-sm font-semibold px-4 py-2 rounded-xl text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  Bekijk je rooster
                </Link>
                {availableCount > 0 && (
                  <Link to="/beschikbaarheid"
                    className="text-sm font-semibold text-white/80 hover:text-white border border-white/25 hover:border-white/50 px-4 py-2 rounded-xl transition-colors">
                    Meer diensten →
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Je rooster</p>
                <p className="text-2xl font-semibold mt-2">Nog geen dienst ingepland</p>
                <p className="text-white/60 text-sm mt-1.5">
                  {availableCount > 0
                    ? `Er ${availableCount === 1 ? 'is 1 dienst' : `zijn ${availableCount} diensten`} waarvoor je je kunt aanmelden.`
                    : activePeriod
                    ? 'Alle beschikbare diensten zijn op dit moment gevuld.'
                    : 'Er is momenteel geen open inschrijving.'}
                </p>
              </div>
              {availableCount > 0 && (
                <div className="mt-5">
                  <Link to="/beschikbaarheid"
                    className="inline-block text-sm font-bold px-4 py-2 rounded-xl text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: 'var(--color-primary)' }}>
                    Bekijk beschikbare diensten →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>

        {/* Deze week: strip + uren */}
        <div className="card p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-dark">Deze week</p>
              <p className="text-[13px] text-gray-400">{nl(weekHours)} / {weekMin}–{weekMax}u</p>
            </div>
            <WeekStrip weekMap={weekMap} />
          </div>
          <div>
            <ProgressBar value={weekHours} max={weekMax} marker={weekMin} />
            <p className="text-[13px] text-gray-400 mt-2">
              {weekHours >= weekMin
                ? 'Je zit deze week binnen je contracturen.'
                : weekHours > 0
                ? `Nog ${nl(weekMin - weekHours)} uur tot je contractminimum.`
                : 'Nog geen diensten deze week.'}
            </p>
          </div>
        </div>
      </div>

      {/* Rij 2: maand + inschrijving + aandacht */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 items-stretch">
        <div className="card p-5 sm:p-6">
          <p className="text-sm font-semibold text-dark">Deze maand</p>
          <p className="text-2xl font-bold text-dark mt-2">{nl(monthHours)}<span className="text-sm font-semibold text-gray-400"> uur</span></p>
          <p className="text-[13px] text-gray-400 mt-0.5">
            {monthShiftCount} dienst{monthShiftCount !== 1 ? 'en' : ''}
            {monthHours < monthMax && <> · nog {nl(monthMax - monthHours)} uur mogelijk</>}
          </p>
          <ProgressBar value={monthHours} max={monthMax} />
        </div>

        <div className="card p-5 sm:p-6 flex flex-col justify-between">
          {activePeriod ? (
            <>
              <div>
                <p className="text-sm font-semibold text-dark capitalize">
                  {monthLabel(activePeriod.year, activePeriod.month)}-inschrijving
                </p>
                <p className="text-2xl font-bold mt-2" style={{ color: 'var(--color-primary)' }}>
                  {availableCount}<span className="text-sm font-semibold text-gray-400"> beschikbaar</span>
                </p>
                <p className="text-[13px] text-gray-400 mt-0.5">
                  {activePeriod.availability_deadline
                    ? <>Sluit {new Date(activePeriod.availability_deadline).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</>
                    : 'Inschrijving is geopend'}
                </p>
              </div>
              <Link to="/beschikbaarheid" className="text-sm font-semibold mt-3" style={{ color: 'var(--color-primary)' }}>
                Diensten bekijken →
              </Link>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-dark">Inschrijving</p>
                <p className="text-2xl font-bold text-gray-300 mt-2">Gesloten</p>
                <p className="text-[13px] text-gray-400 mt-0.5">Je krijgt een melding zodra een nieuwe maand opent.</p>
              </div>
              <Link to="/beschikbaarheid" className="text-sm font-semibold text-gray-400 hover:text-dark transition-colors mt-3">
                Rooster bekijken →
              </Link>
            </>
          )}
        </div>

        <div className="card p-5 sm:p-6 sm:col-span-2 lg:col-span-1">
          <p className="text-sm font-semibold text-dark mb-3">Aandacht nodig</p>
          {attention.length === 0 ? (
            <div className="flex items-center gap-2.5 py-2">
              <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
              <p className="text-[13px] text-gray-400">Niets dat op je wacht — je bent helemaal bij.</p>
            </div>
          ) : (
            <div className="space-y-1 -mx-2">
              {attention.map(a => (
                <Link key={a.label} to={a.to} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors group">
                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-dark leading-tight">{a.label}</span>
                    <span className="block text-xs text-gray-400 mt-0.5">{a.detail}</span>
                  </span>
                  <span className="text-gray-300 group-hover:text-gray-500 transition-colors">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rij 3: aankomende diensten */}
      {upcomingShifts.length > 1 && (
        <div className="card overflow-hidden">
          <div className="px-5 sm:px-6 py-3.5 border-b border-gray-50 flex items-center justify-between">
            <h2 className="font-semibold text-dark text-sm">Aankomende diensten</h2>
            <Link to="/mijn-rooster" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              Alles bekijken →
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {upcomingShifts.slice(1, 6).map(({ shift }) => (
              <div key={shift.id} className="px-5 sm:px-6 py-3.5 flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0 text-white leading-none"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  <span className="text-sm font-bold">{new Date(shift.shift_date + 'T00:00:00').getDate()}</span>
                  <span className="text-[9px] font-semibold uppercase mt-0.5">
                    {new Date(shift.shift_date + 'T00:00:00').toLocaleDateString('nl-NL', { month: 'short' })}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-dark capitalize text-sm truncate">{formatDate(shift.shift_date)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} · {String(shift.duration_hours).replace('.', ',')}u
                  </p>
                </div>
                <span className="text-xs font-medium text-gray-400 capitalize flex-shrink-0">
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

// Ma–zo van de huidige week met je diensten als gevulde dagen.
function WeekStrip({ weekMap }: { weekMap: Record<string, string[]> }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const monday = new Date(today); monday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow))
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    return d
  })
  const labels = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z']
  return (
    <div className="grid grid-cols-7 gap-1 mt-3 mb-3">
      {days.map((d, i) => {
        const iso = dateToISO(d)
        const has = (weekMap[iso] || []).length > 0
        const isToday = iso === dateToISO(today)
        return (
          <div key={iso} className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-semibold text-gray-300">{labels[i]}</span>
            <span
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold ${
                has ? 'text-white' : 'text-gray-400 bg-gray-50'
              } ${isToday ? 'ring-2 ring-offset-1' : ''}`}
              style={{
                backgroundColor: has ? 'var(--color-primary)' : undefined,
                ...(isToday ? { ['--tw-ring-color' as string]: 'var(--color-primary)' } : {}),
              }}
              title={has ? `${(weekMap[iso] || []).length} dienst(en)` : undefined}
            >
              {d.getDate()}
            </span>
          </div>
        )
      })}
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
