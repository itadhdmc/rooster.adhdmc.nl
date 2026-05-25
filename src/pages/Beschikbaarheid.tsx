import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
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
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

export default function Beschikbaarheid() {
  const { profile } = useAuth()
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null)
  const [shifts, setShifts] = useState<ShiftWithAssignments[]>([])
  const [myAssignments, setMyAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)

  useEffect(() => { loadPeriods() }, [])
  useEffect(() => { if (selectedPeriod && profile) loadShifts() }, [selectedPeriod, profile])
  useEffect(() => { setWeekOffset(0) }, [selectedPeriod?.id])

  async function loadPeriods() {
    const { data } = await supabase
      .from('roster_periods')
      .select('*')
      .or('availability_open.eq.true,second_round_open.eq.true')
      .order('year').order('month')
    setPeriods(data || [])
    if (data?.length) setSelectedPeriod(data[0])
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
    if (error) alert('Inschrijven mislukt: ' + error.message)
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
  const weekDays = getWeekDays(weekOffset)
  const weekStart = weekDays[0]
  const weekEnd = weekDays[4]

  const weekShifts = shifts.filter(s => {
    const d = new Date(s.shift_date + 'T00:00:00')
    return d >= weekStart && d <= weekEnd
  })

  const shiftGrid = weekShifts.reduce<Record<string, Record<string, ShiftWithAssignments>>>((acc, s) => {
    if (!acc[s.shift_date]) acc[s.shift_date] = {}
    acc[s.shift_date][s.shift_type] = s
    return acc
  }, {})

  const myPendingCount = myAssignments.filter(a =>
    a.status === 'pending' && shifts.some(s => s.id === a.shift_id)).length
  const myApprovedCount = myAssignments.filter(a =>
    a.status === 'approved' && shifts.some(s => s.id === a.shift_id)).length

  const weekLabel = `${weekDays[0].toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} – ${weekDays[4].toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}`

  if (loading) return <Spinner />

  if (periods.length === 0) {
    return (
      <div className="card p-16 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-dark">Geen open inschrijving</h2>
        <p className="text-gray-400 text-sm mt-2">Er is momenteel geen periode open voor inschrijving.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">Inschrijven</h1>
          <p className="text-gray-400 text-sm mt-0.5">Klik op + om je aan te melden voor een dienst.</p>
        </div>
        {periods.length > 1 && (
          <select
            className="border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-medium text-dark focus:outline-none"
            value={selectedPeriod?.id}
            onChange={e => setSelectedPeriod(periods.find(p => p.id === e.target.value) || null)}
          >
            {periods.map(p => <option key={p.id} value={p.id}>{monthLabel(p.year, p.month)}</option>)}
          </select>
        )}
      </div>

      {/* Deadline */}
      {selectedPeriod?.availability_deadline && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          </div>
          <p className="text-sm text-gray-600">
            Deadline:{' '}
            <span className="font-semibold text-dark">
              {new Date(selectedPeriod.availability_deadline).toLocaleDateString('nl-NL', {
                day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </p>
        </div>
      )}

      {/* Stats */}
      {(myPendingCount > 0 || myApprovedCount > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {myPendingCount > 0 && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <p className="text-xl font-bold text-dark">{myPendingCount}</p>
              </div>
              <p className="text-xs text-gray-400">Wacht op goedkeuring</p>
            </div>
          )}
          {myApprovedCount > 0 && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <p className="text-xl font-bold text-dark">{myApprovedCount}</p>
              </div>
              <p className="text-xs text-gray-400">Goedgekeurd</p>
            </div>
          )}
        </div>
      )}

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => setWeekOffset(w => w - 1)} className="btn-ghost text-sm px-3 py-2">
          ← Vorige
        </button>
        <div className="text-center">
          <p className="font-semibold text-dark text-sm">{weekLabel}</p>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-xs text-gray-400 hover:text-dark transition-colors mt-0.5">
              Terug naar deze week
            </button>
          )}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} className="btn-ghost text-sm px-3 py-2">
          Volgende →
        </button>
      </div>

      {/* Weekly grid */}
      <div className="card overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-6 bg-gray-50/60 border-b border-gray-100">
          <div className="py-3 border-r border-gray-100" />
          {weekDays.map(day => {
            const iso = dateToISO(day)
            const isToday = iso === dateToISO(today)
            return (
              <div key={iso} className="py-3 text-center border-l border-gray-100 first:border-0">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${isToday ? 'text-salmon-500' : 'text-gray-400'}`}>
                  {day.toLocaleDateString('nl-NL', { weekday: 'short' })}
                </p>
                <p className={`text-sm font-bold mt-0.5 ${isToday ? 'text-salmon-500' : 'text-dark'}`}>
                  {day.getDate()}
                </p>
              </div>
            )
          })}
        </div>

        {/* Shift rows: ochtend + middag */}
        {(['ochtend', 'middag'] as const).map((shiftType, rowIdx) => (
          <div key={shiftType} className={`grid grid-cols-6 ${rowIdx === 0 ? 'border-b border-gray-100' : ''}`}>
            {/* Row label */}
            <div className="flex items-center justify-center py-6 px-2 border-r border-gray-100 bg-gray-50/30">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                shiftType === 'ochtend' ? 'bg-orange-50 text-orange-500' : 'bg-indigo-50 text-indigo-500'
              }`}>
                {shiftType === 'ochtend' ? 'Ochtend' : 'Middag'}
              </span>
            </div>

            {/* Day cells */}
            {weekDays.map(day => {
              const iso = dateToISO(day)
              const shift = (shiftGrid[iso] || {})[shiftType]
              const myAssignment = shift ? myAssignments.find(a => a.shift_id === shift.id) : null
              const isPast = day < today

              if (!shift) {
                return (
                  <div key={iso} className="flex items-center justify-center py-6 border-l border-gray-100">
                    <span className="text-gray-200 text-sm">—</span>
                  </div>
                )
              }

              const isPending = myAssignment?.status === 'pending'
              const isApproved = myAssignment?.status === 'approved'
              const isFull = shift.open_spots <= 0 && !myAssignment

              return (
                <div key={iso} className="flex flex-col items-center justify-center gap-2 py-4 px-1 border-l border-gray-100">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    isApproved ? 'bg-indigo-300' :
                    isPending ? 'bg-amber-300' :
                    isFull || isPast ? 'bg-gray-200' :
                    'bg-emerald-300'
                  }`} />

                  <p className="text-[10px] text-gray-400 font-medium leading-none">
                    {shift.start_time.slice(0, 5)}
                  </p>

                  {isApproved && (
                    <span className="text-[11px] font-bold text-indigo-400 leading-none">✓</span>
                  )}
                  {isPending && myAssignment && (
                    <button
                      onClick={() => withdraw(myAssignment.id)}
                      disabled={processing === myAssignment.id}
                      className="text-[10px] font-semibold text-amber-500 hover:text-amber-700 transition-colors disabled:opacity-50 leading-none"
                    >
                      {processing === myAssignment.id ? '...' : 'Afmelden'}
                    </button>
                  )}
                  {!myAssignment && !isFull && !isPast && (
                    <button
                      onClick={() => signUp(shift.id)}
                      disabled={processing === shift.id}
                      className="w-7 h-5 rounded-md flex items-center justify-center text-white text-xs font-bold disabled:opacity-50 transition-opacity"
                      style={{ backgroundColor: '#f87369' }}
                    >
                      {processing === shift.id ? '·' : '+'}
                    </button>
                  )}
                  {(isFull || (isPast && !myAssignment)) && (
                    <span className="text-[10px] text-gray-300 font-medium leading-none">
                      {isFull ? 'vol' : '—'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* No shifts this week */}
      {weekShifts.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-gray-400 text-sm font-medium">Geen diensten in deze week</p>
          <p className="text-gray-300 text-xs mt-1">
            Navigeer naar een week in{' '}
            {selectedPeriod ? monthLabel(selectedPeriod.year, selectedPeriod.month) : 'de periode'}.
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-gray-400">
          <span className="w-2 h-2 rounded-full bg-emerald-300 inline-block" /> Plek vrij
        </span>
        <span className="flex items-center gap-1.5 text-gray-400">
          <span className="w-2 h-2 rounded-full bg-amber-300 inline-block" /> Aangemeld
        </span>
        <span className="flex items-center gap-1.5 text-gray-400">
          <span className="w-2 h-2 rounded-full bg-indigo-300 inline-block" /> Ingeroosterd
        </span>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: '#f87369', borderTopColor: 'transparent' }} />
    </div>
  )
}
