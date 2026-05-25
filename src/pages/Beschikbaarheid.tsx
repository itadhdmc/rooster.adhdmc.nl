import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { RosterPeriod, ShiftWithAssignments, Assignment } from '../types'
import { formatDate, monthLabel } from '../utils/dates'

export default function Beschikbaarheid() {
  const { profile } = useAuth()
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null)
  const [shifts, setShifts] = useState<ShiftWithAssignments[]>([])
  const [myAssignments, setMyAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  useEffect(() => { loadPeriods() }, [])
  useEffect(() => { if (selectedPeriod && profile) loadShifts() }, [selectedPeriod, profile])

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

  if (loading) return <Spinner />

  if (periods.length === 0) {
    return (
      <div className="card p-16 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-dark">Geen open inschrijving</h2>
        <p className="text-gray-400 text-sm mt-2">Er is momenteel geen periode open voor inschrijving.</p>
      </div>
    )
  }

  // Group shifts by date
  const grouped = shifts.reduce<Record<string, ShiftWithAssignments[]>>((acc, s) => {
    if (!acc[s.shift_date]) acc[s.shift_date] = []
    acc[s.shift_date].push(s)
    return acc
  }, {})

  const myPendingCount = myAssignments.filter(a => a.status === 'pending' &&
    shifts.some(s => s.id === a.shift_id)).length
  const myApprovedCount = myAssignments.filter(a => a.status === 'approved' &&
    shifts.some(s => s.id === a.shift_id)).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">Inschrijven</h1>
          <p className="text-gray-400 text-sm mt-0.5">Meld je aan voor de diensten die je wilt werken.</p>
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
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-sm text-amber-800">
          <span>⏰</span>
          <span>Deadline: <strong>{new Date(selectedPeriod.availability_deadline).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</strong></span>
        </div>
      )}

      {/* Status summary */}
      {(myPendingCount > 0 || myApprovedCount > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {myPendingCount > 0 && (
            <div className="card p-4 border-l-4 border-amber-400">
              <p className="text-xl font-bold text-amber-600">{myPendingCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Wacht op goedkeuring</p>
            </div>
          )}
          {myApprovedCount > 0 && (
            <div className="card p-4 border-l-4 border-green-400">
              <p className="text-xl font-bold text-green-600">{myApprovedCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Goedgekeurd</p>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-gray-500">
          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Plek beschikbaar
        </span>
        <span className="flex items-center gap-1.5 text-gray-500">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Aangemeld (wacht op goedkeuring)
        </span>
        <span className="flex items-center gap-1.5 text-gray-500">
          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Ingeroosterd
        </span>
      </div>

      {/* Shifts per dag */}
      <div className="space-y-3">
        {Object.entries(grouped).map(([date, dayShifts]) => (
          <div key={date} className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-50 bg-surface">
              <p className="font-bold text-dark text-sm capitalize">{formatDate(date)}</p>
            </div>
            <div className="divide-y divide-gray-50">
              {dayShifts.map(shift => {
                const myAssignment = myAssignments.find(a => a.shift_id === shift.id)
                const isPending = myAssignment?.status === 'pending'
                const isApproved = myAssignment?.status === 'approved'
                const isFull = shift.open_spots <= 0 && !myAssignment
                const isOchtend = shift.shift_type === 'ochtend'

                return (
                  <div key={shift.id} className="px-5 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Status dot */}
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        isApproved ? 'bg-blue-400' :
                        isPending ? 'bg-amber-400' :
                        isFull ? 'bg-gray-200' :
                        'bg-green-400'
                      }`} />

                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            isOchtend ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {isOchtend ? 'Ochtend' : 'Middag'}
                          </span>
                          <span className="text-xs text-gray-400">
                            {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} ({shift.duration_hours}u)
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {isApproved ? (
                            <span className="text-blue-600 font-semibold">✓ Ingeroosterd</span>
                          ) : isPending ? (
                            <span className="text-amber-600 font-semibold">Wacht op goedkeuring</span>
                          ) : isFull ? (
                            <span className="text-gray-400">Vol ({shift.assigned_count}/{shift.max_students})</span>
                          ) : (
                            <span>{shift.open_spots} van {shift.max_students} plek{shift.max_students !== 1 ? 'ken' : ''} vrij</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex-shrink-0">
                      {isApproved && (
                        <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl">
                          Ingeroosterd
                        </span>
                      )}
                      {isPending && myAssignment && (
                        <button
                          onClick={() => withdraw(myAssignment.id)}
                          disabled={processing === myAssignment.id}
                          className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition-colors disabled:opacity-50"
                        >
                          {processing === myAssignment.id ? '...' : 'Afmelden'}
                        </button>
                      )}
                      {!myAssignment && !isFull && (
                        <button
                          onClick={() => signUp(shift.id)}
                          disabled={processing === shift.id}
                          className="text-xs font-bold text-white px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
                          style={{ backgroundColor: '#f87369' }}
                        >
                          {processing === shift.id ? '...' : 'Aanmelden'}
                        </button>
                      )}
                      {!myAssignment && isFull && (
                        <span className="text-xs text-gray-400 px-3 py-1.5 rounded-xl bg-gray-50">
                          Vol
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
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
