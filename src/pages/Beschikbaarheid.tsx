import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSettings, shiftTypeConfig } from '../hooks/useSettings'
import { supabase } from '../lib/supabase'
import { RosterPeriod, ShiftWithAssignments, Assignment } from '../types'
import { dateToISO, monthLabel } from '../utils/dates'

function getWeekDays(weekOffset: number): Date[] {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday + weekOffset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

// Afmelden van de reservelijst kan tot 24 uur voor de start van de dienst
// (dezelfde grens wordt server-side afgedwongen via RLS).
function canLeaveReserve(shift: Pick<ShiftWithAssignments, 'shift_date' | 'start_time'>): boolean {
  return new Date(`${shift.shift_date}T${shift.start_time}`).getTime() - Date.now() > 24 * 60 * 60 * 1000
}

// Hoeveel weken (t.o.v. deze week) moet je vooruit/terug om bij de eerste
// week van een gekozen maand uit te komen.
function getWeekOffsetForMonth(year: number, month: number): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const cd = today.getDay()
  const currentMonday = new Date(today)
  currentMonday.setDate(today.getDate() + (cd === 0 ? -6 : 1 - cd))

  const first = new Date(year, month - 1, 1)
  const fd = first.getDay()
  const targetMonday = new Date(first)
  targetMonday.setDate(first.getDate() - (fd === 0 ? 6 : fd - 1))

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  return Math.round((targetMonday.getTime() - currentMonday.getTime()) / WEEK_MS)
}

type Filter = 'alle' | 'beschikbaar' | 'mijn'

export default function Beschikbaarheid() {
  const { profile } = useAuth()
  const { settings } = useSettings()
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null)
  const [shifts, setShifts] = useState<ShiftWithAssignments[]>([])
  const [myAssignments, setMyAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [filter, setFilter] = useState<Filter>('alle')

  useEffect(() => { loadPeriods() }, [])
  useEffect(() => { if (selectedPeriod && profile) loadShifts() }, [selectedPeriod, profile])
  // Spring automatisch naar de gekozen maand (huidige maand => deze week).
  useEffect(() => {
    if (!selectedPeriod) return
    const now = new Date()
    const isCurrentMonth = selectedPeriod.year === now.getFullYear() && selectedPeriod.month === now.getMonth() + 1
    setWeekOffset(isCurrentMonth ? 0 : getWeekOffsetForMonth(selectedPeriod.year, selectedPeriod.month))
  }, [selectedPeriod?.id])

  async function loadPeriods() {
    const { data } = await supabase
      .from('roster_periods')
      .select('*')
      .or('availability_open.eq.true,second_round_open.eq.true,roster_published.eq.true')
      .order('year').order('month')
    setPeriods(data || [])
    if (data?.length) {
      const now = new Date()
      const current = data.find(p => p.year === now.getFullYear() && p.month === now.getMonth() + 1)
      const open = data.find(p => p.availability_open || p.second_round_open)
      setSelectedPeriod(current || open || data[data.length - 1])
    }
    setLoading(false)
  }

  async function loadShifts() {
    if (!selectedPeriod || !profile) return
    const [{ data: s }, { data: a }] = await Promise.all([
      supabase.from('shifts_with_assignments')
        .select('*')
        .eq('period_id', selectedPeriod.id)
        .order('shift_date').order('shift_type'),
      supabase.from('assignments')
        .select('*')
        .eq('user_id', profile.id),
    ])
    setShifts(s || [])
    setMyAssignments(a || [])
  }

  async function signUp(shiftId: string) {
    if (!profile) return
    setProcessing(shiftId)
    const { error } = await supabase.from('assignments').insert({
      shift_id: shiftId,
      user_id: profile.id,
      status: 'pending',
    })
    if (error) alert('Aanmelden mislukt: ' + error.message)
    await loadShifts()
    setProcessing(null)
  }

  async function withdraw(assignmentId: string) {
    setProcessing(assignmentId)
    await supabase.from('assignments').delete().eq('id', assignmentId)
    await loadShifts()
    setProcessing(null)
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const signupOpen = !!(selectedPeriod && (selectedPeriod.availability_open || selectedPeriod.second_round_open))
  const weekDays = getWeekDays(weekOffset)

  const monthHomeOffset = selectedPeriod
    ? (today.getFullYear() === selectedPeriod.year && today.getMonth() + 1 === selectedPeriod.month
        ? 0 : getWeekOffsetForMonth(selectedPeriod.year, selectedPeriod.month))
    : 0

  const myByShift = useMemo(() => {
    const map = new Map<string, Assignment>()
    for (const a of myAssignments) map.set(a.shift_id, a)
    return map
  }, [myAssignments])

  function matchesFilter(s: ShiftWithAssignments): boolean {
    const mine = myByShift.get(s.id)
    const isPast = new Date(s.shift_date + 'T00:00:00') < today
    if (filter === 'mijn') return !!mine
    if (filter === 'beschikbaar') return !mine && !isPast && s.open_spots > 0 && signupOpen
    return true
  }

  const myCount = shifts.filter(s => myByShift.has(s.id)).length
  const availableCount = shifts.filter(s =>
    !myByShift.has(s.id) && new Date(s.shift_date + 'T00:00:00') >= today && s.open_spots > 0 && signupOpen).length

  // Weekweergave (alleen bij filter 'alle'): dagen van de gekozen week.
  const weekView = filter === 'alle'
  const weekStart = weekDays[0]
  const weekEnd = weekDays[5]
  const visibleShifts = shifts.filter(s => {
    if (!matchesFilter(s)) return false
    if (!weekView) return true
    const d = new Date(s.shift_date + 'T00:00:00')
    return d >= weekStart && d <= weekEnd
  })

  // Groeperen per dag (voor lijst- en kolomweergave).
  const byDay = useMemo(() => {
    const map = new Map<string, ShiftWithAssignments[]>()
    for (const s of visibleShifts) {
      if (!map.has(s.shift_date)) map.set(s.shift_date, [])
      map.get(s.shift_date)!.push(s)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visibleShifts])

  const weekLabel = `${weekDays[0].getDate()} – ${weekDays[5].toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}`

  if (loading) return <Spinner />

  if (periods.length === 0) {
    return (
      <div className="card p-16 text-center">
        <h2 className="text-lg font-bold text-dark">Geen rooster beschikbaar</h2>
        <p className="text-gray-400 text-sm mt-2">Er is momenteel geen open inschrijving of gepubliceerd rooster.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">{signupOpen ? 'Inschrijven' : 'Rooster'}</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {signupOpen
              ? 'Meld je aan voor de diensten die je wilt werken.'
              : 'De inschrijving is gesloten. Ruilen kan via Mijn rooster.'}
          </p>
        </div>
        {periods.length > 1 && (
          <select
            className="border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-medium text-dark focus:outline-none capitalize"
            value={selectedPeriod?.id}
            onChange={e => setSelectedPeriod(periods.find(p => p.id === e.target.value) || null)}
          >
            {periods.map(p => <option key={p.id} value={p.id}>{monthLabel(p.year, p.month)}</option>)}
          </select>
        )}
      </div>

      {/* Open inschrijving-kaart */}
      {signupOpen && selectedPeriod && (
        <div className="card px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-dark capitalize">
              {monthLabel(selectedPeriod.year, selectedPeriod.month)}-inschrijving is geopend
            </p>
            <p className="text-[13px] text-gray-400 mt-0.5">
              Nog {availableCount} dienst{availableCount !== 1 ? 'en' : ''} beschikbaar
              {selectedPeriod.availability_deadline && (
                <> · sluit op {new Date(selectedPeriod.availability_deadline).toLocaleDateString('nl-NL', {
                  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                })}</>
              )}
            </p>
          </div>
          {filter !== 'beschikbaar' && availableCount > 0 && (
            <button onClick={() => setFilter('beschikbaar')}
              className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--color-primary)' }}>
              Bekijk beschikbare diensten →
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip active={filter === 'alle'} onClick={() => setFilter('alle')} label="Alle diensten" />
        <FilterChip active={filter === 'beschikbaar'} onClick={() => setFilter('beschikbaar')}
          label={`Beschikbaar${availableCount > 0 ? ` (${availableCount})` : ''}`} />
        <FilterChip active={filter === 'mijn'} onClick={() => setFilter('mijn')}
          label={`Mijn aanmeldingen${myCount > 0 ? ` (${myCount})` : ''}`} />
      </div>

      {/* Weeknavigatie (alleen in weekweergave) */}
      {weekView && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => setWeekOffset(w => w - 1)} aria-label="Vorige week"
              className="w-9 h-9 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-dark hover:border-gray-300 transition-colors">‹</button>
            <p className="font-semibold text-dark text-sm px-3 whitespace-nowrap">{weekLabel}</p>
            <button onClick={() => setWeekOffset(w => w + 1)} aria-label="Volgende week"
              className="w-9 h-9 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-dark hover:border-gray-300 transition-colors">›</button>
          </div>
          {weekOffset !== monthHomeOffset && (
            <button onClick={() => setWeekOffset(monthHomeOffset)}
              className="text-sm font-semibold px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-dark hover:border-gray-300 transition-colors">
              {monthHomeOffset === 0 ? 'Vandaag' : monthLabel(selectedPeriod!.year, selectedPeriod!.month).split(' ')[0]}
            </button>
          )}
        </div>
      )}

      {byDay.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-400 text-sm font-medium">
            {filter === 'mijn' ? 'Je hebt nog geen aanmeldingen in deze maand.'
              : filter === 'beschikbaar' ? 'Geen beschikbare diensten meer in deze maand.'
              : 'Geen diensten in deze week.'}
          </p>
          {filter === 'mijn' && availableCount > 0 && (
            <button onClick={() => setFilter('beschikbaar')} className="text-sm font-semibold mt-2" style={{ color: 'var(--color-primary)' }}>
              Bekijk beschikbare diensten →
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop: kolommen per dag (alleen weekweergave) */}
          {weekView && (
            <div className="hidden md:grid grid-cols-6 gap-3 items-start">
              {weekDays.map(day => {
                const iso = dateToISO(day)
                const dayShifts = byDay.find(([d]) => d === iso)?.[1] || []
                const isToday = iso === dateToISO(today)
                return (
                  <div key={iso} className="space-y-2 min-w-0">
                    <DayHeader day={day} isToday={isToday} />
                    {dayShifts.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-gray-300 text-xs">—</div>
                    ) : dayShifts.map(s => (
                      <ShiftCard key={s.id} shift={s} mine={myByShift.get(s.id)} compact
                        signupOpen={signupOpen} today={today} processing={processing}
                        typeLabel={shiftTypeConfig(settings, s.shift_type).label}
                        meId={profile?.id} onSignUp={signUp} onWithdraw={withdraw} />
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {/* Mobiel (en lijstfilters op elk formaat): verticale agenda */}
          <div className={`${weekView ? 'md:hidden' : ''} space-y-5`}>
            {byDay.map(([iso, dayShifts]) => {
              const day = new Date(iso + 'T00:00:00')
              const isToday = iso === dateToISO(today)
              return (
                <div key={iso}>
                  <p className={`text-xs font-bold uppercase tracking-widest mb-2 ${isToday ? '' : 'text-gray-400'}`}
                    style={isToday ? { color: 'var(--color-primary)' } : {}}>
                    {day.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {isToday && ' · vandaag'}
                  </p>
                  <div className={`grid gap-2 ${weekView ? '' : 'sm:grid-cols-2'}`}>
                    {dayShifts.map(s => (
                      <ShiftCard key={s.id} shift={s} mine={myByShift.get(s.id)}
                        signupOpen={signupOpen} today={today} processing={processing}
                        typeLabel={shiftTypeConfig(settings, s.shift_type).label}
                        meId={profile?.id} onSignUp={signUp} onWithdraw={withdraw} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// Eén dienst als duidelijk interactief object: status in tekst,
// capaciteit zichtbaar, één actie per kaart.
// ------------------------------------------------------------

function ShiftCard({ shift, mine, signupOpen, today, processing, typeLabel, meId, onSignUp, onWithdraw, compact }: {
  shift: ShiftWithAssignments
  mine?: Assignment
  signupOpen: boolean
  today: Date
  processing: string | null
  typeLabel: string
  meId?: string
  onSignUp: (shiftId: string) => void
  onWithdraw: (assignmentId: string) => void
  compact?: boolean
}) {
  const isPast = new Date(shift.shift_date + 'T00:00:00') < today
  const isApproved = mine?.status === 'approved'
  const isPending = mine?.status === 'pending'
  const isReserve = mine?.status === 'reserve'
  const busy = processing === shift.id || processing === mine?.id

  const colleagues = (shift.assigned_students || [])
    .filter(st => st.status === 'approved' && st.user_id !== meId)
    .map(st => (st.full_name || st.email).split(' ')[0])
  const reserveCount = (shift.assigned_students || []).filter(st => st.status === 'reserve').length
  const isFull = shift.open_spots <= 0

  return (
    <div className={`bg-white rounded-xl border p-3.5 ${isPast && !mine ? 'opacity-50' : ''} ${
      isApproved ? 'border-emerald-100' : isPending ? 'border-amber-100' : isReserve ? 'border-sky-100' : 'border-gray-100'
    }`}>
      {/* Type + tijd */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-dark truncate">{typeLabel}</p>
        <p className="text-xs text-gray-400 flex-shrink-0">
          {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
        </p>
      </div>

      {/* Capaciteit + collega's */}
      <div className={`mt-1.5 ${compact ? 'min-h-[34px]' : ''}`}>
        <p className="text-xs text-gray-400">
          <PersonIcon className="w-3 h-3 inline -mt-0.5 mr-1" />
          {shift.assigned_count} / {shift.max_students} plek{shift.max_students !== 1 ? 'ken' : ''}
          {reserveCount > 0 && <span> · {reserveCount} reserve</span>}
        </p>
        {colleagues.length > 0 && (
          <p className="text-xs text-gray-500 font-medium truncate mt-0.5">{colleagues.join(' · ')}</p>
        )}
      </div>

      {/* Status + actie (tekst, niet alleen kleur) */}
      <div className="mt-2.5">
        {isApproved && (
          <p className="text-xs font-semibold text-emerald-600">✓ Ingeroosterd</p>
        )}

        {isPending && mine && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-600 leading-tight">
              Aangemeld<span className="block font-normal text-amber-500/80">wacht op goedkeuring</span>
            </p>
            <button onClick={() => onWithdraw(mine.id)} disabled={busy}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-dark hover:border-gray-300 transition-colors disabled:opacity-50">
              {busy ? '...' : 'Afmelden'}
            </button>
          </div>
        )}

        {isReserve && mine && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-sky-600 leading-tight">
              Reservelijst<span className="block font-normal text-sky-500/80">we benaderen je bij een plek</span>
            </p>
            {canLeaveReserve(shift) && !isPast && (
              <button
                onClick={() => confirm('Wil je jezelf van de reservelijst voor deze dienst afmelden?') && onWithdraw(mine.id)}
                disabled={busy}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-dark hover:border-gray-300 transition-colors disabled:opacity-50">
                {busy ? '...' : 'Afmelden'}
              </button>
            )}
          </div>
        )}

        {!mine && !isPast && signupOpen && !isFull && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-emerald-600">
              {shift.open_spots === 1 ? '1 plek beschikbaar' : `${shift.open_spots} plekken beschikbaar`}
            </p>
            <button onClick={() => onSignUp(shift.id)} disabled={busy}
              className="text-xs font-bold text-white px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {busy ? '...' : '+ Aanmelden'}
            </button>
          </div>
        )}

        {!mine && !isPast && signupOpen && isFull && (
          <p className="text-xs font-semibold text-gray-400">Vol</p>
        )}

        {!mine && (isPast || !signupOpen) && (
          <p className="text-xs text-gray-300">{isPast ? 'Geweest' : isFull ? 'Vol' : 'Inschrijving gesloten'}</p>
        )}
      </div>
    </div>
  )
}

function DayHeader({ day, isToday }: { day: Date; isToday: boolean }) {
  return (
    <div className="text-center py-1.5">
      <p className={`text-[10px] font-bold uppercase tracking-widest ${isToday ? '' : 'text-gray-400'}`}
        style={isToday ? { color: 'var(--color-primary)' } : {}}>
        {day.toLocaleDateString('nl-NL', { weekday: 'short' })}
      </p>
      <p className={`text-sm font-bold ${isToday ? '' : 'text-dark'}`} style={isToday ? { color: 'var(--color-primary)' } : {}}>
        {day.getDate()}
      </p>
    </div>
  )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`text-sm font-medium px-3.5 py-2 rounded-xl border transition-colors ${
        active
          ? 'text-white border-transparent'
          : 'bg-white border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300'
      }`}
      style={active ? { backgroundColor: 'var(--color-dark)' } : {}}>
      {label}
    </button>
  )
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
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
