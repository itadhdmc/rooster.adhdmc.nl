import { useEffect, useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ShiftWithAssignments, Profile, RosterPeriod } from '../../types'
import { formatDate, monthLabel, dateToISO, getWeeksInMonth } from '../../utils/dates'

export default function RoosterBeheer() {
  const { periodId } = useParams<{ periodId: string }>()
  const [period, setPeriod] = useState<RosterPeriod | null>(null)
  const [shifts, setShifts] = useState<ShiftWithAssignments[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showPendingPanel, setShowPendingPanel] = useState(false)

  useEffect(() => { loadAll() }, [periodId])

  async function loadAll() {
    if (!periodId) return
    const [{ data: p }, { data: s }, { data: st }] = await Promise.all([
      supabase.from('roster_periods').select('*').eq('id', periodId).single(),
      supabase.from('shifts_with_assignments').select('*').eq('period_id', periodId).order('shift_date').order('shift_type'),
      supabase.from('profiles').select('*').eq('role', 'student').eq('active', true),
    ])
    setPeriod(p)
    setShifts(s || [])
    setStudents(st || [])
    setLoading(false)
  }

  async function approveAssignment(assignmentId: string) {
    setProcessing(assignmentId)
    const { error } = await supabase
      .from('assignments')
      .update({ status: 'approved' })
      .eq('id', assignmentId)
    if (error) alert('Goedkeuren mislukt: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  async function rejectAssignment(assignmentId: string) {
    setProcessing(assignmentId)
    await supabase.from('assignments').delete().eq('id', assignmentId)
    await loadAll()
    setProcessing(null)
  }

  async function removeAssignment(assignmentId: string) {
    setProcessing(assignmentId)
    await supabase.from('assignments').delete().eq('id', assignmentId)
    await loadAll()
    setProcessing(null)
  }

  async function approveAll(assignmentIds: string[]) {
    setProcessing('bulk')
    for (const id of assignmentIds) {
      await supabase.from('assignments').update({ status: 'approved' }).eq('id', id)
    }
    await loadAll()
    setProcessing(null)
  }

  async function directAssign(shiftId: string, userId: string) {
    setProcessing(shiftId + userId)
    const { error } = await supabase.from('assignments').insert({
      shift_id: shiftId,
      user_id: userId,
      status: 'approved',
    })
    if (error) alert('Fout: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  const shiftsByDate = useMemo(() =>
    shifts.reduce<Record<string, Record<string, ShiftWithAssignments>>>((acc, s) => {
      if (!acc[s.shift_date]) acc[s.shift_date] = {}
      acc[s.shift_date][s.shift_type] = s
      return acc
    }, {}),
    [shifts]
  )

  const selectedDayShifts = selectedDate
    ? shifts.filter(s => s.shift_date === selectedDate).sort((a, b) => a.shift_type.localeCompare(b.shift_type))
    : []

  // Students not yet assigned or pending for a given shift
  function unassignedStudents(shift: ShiftWithAssignments): Profile[] {
    const takenIds = new Set((shift.assigned_students || []).map(s => s.user_id))
    return students.filter(s => !takenIds.has(s.id))
  }

  // Total pending requests across all shifts
  const totalPending = shifts.reduce((n, s) =>
    n + (s.assigned_students || []).filter(a => a.status === 'pending').length, 0)

  if (loading) return <Spinner />
  if (!period) return <div className="text-red-500 p-4">Periode niet gevonden.</div>

  const totalShifts = shifts.length
  const filledShifts = shifts.filter(s => s.open_spots <= 0).length
  const openShifts = totalShifts - filledShifts
  const weeks = getWeeksInMonth(period.year, period.month)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/admin" className="text-gray-400 hover:text-dark transition-colors">← Terug</Link>
        <span className="text-gray-200">/</span>
        <h1 className="font-bold text-dark">{monthLabel(period.year, period.month)}</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-dark">{totalShifts}</p>
          <p className="text-xs text-gray-400 mt-1">Diensten</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{filledShifts}</p>
          <p className="text-xs text-gray-400 mt-1">Vol</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold" style={{ color: openShifts > 0 ? '#f87369' : '#22c55e' }}>
            {openShifts}
          </p>
          <p className="text-xs text-gray-400 mt-1">Open</p>
        </div>
      </div>

      {/* Pending aanvragen banner — klikbaar */}
      {totalPending > 0 && (
        <button
          onClick={() => setShowPendingPanel(v => !v)}
          className="card p-4 flex items-center gap-3 w-full text-left hover:bg-gray-50/60 transition-colors"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-dark">
              {totalPending} aanvra{totalPending === 1 ? 'ag' : 'gen'} wacht op goedkeuring
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {showPendingPanel ? 'Klik om te sluiten' : 'Klik voor snel overzicht'}
            </p>
          </div>
          <svg className={`w-4 h-4 text-gray-300 transition-transform ${showPendingPanel ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Quick-approve panel */}
      {showPendingPanel && totalPending > 0 && (
        <QuickApprovePanel
          shifts={shifts}
          processing={processing}
          onApprove={approveAssignment}
          onReject={rejectAssignment}
          onApproveAll={approveAll}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400">
        <span>Klik op een dag om te beheren</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-emerald-300 inline-block" /> Vol</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-amber-200 inline-block" /> Gedeeltelijk</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-rose-200 inline-block" /> Leeg</span>
      </div>

      {/* Calendar grid */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-6 border-b border-gray-100" style={{ backgroundColor: '#3c3c3b' }}>
          {['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'].map((d, i) => (
            <div key={d} className={`py-3 text-center ${i < 5 ? 'border-r border-white/10' : ''}`}>
              <span className="hidden sm:inline text-xs font-semibold text-white/50 uppercase tracking-widest">{d}</span>
              <span className="sm:hidden text-xs font-semibold text-white/50 uppercase tracking-widest">{d.slice(0, 2)}</span>
            </div>
          ))}
        </div>
        <div className="divide-y divide-gray-100">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-6 divide-x divide-gray-100">
              {week.map((day, di) => {
                if (!day) return <div key={di} className="bg-gray-50/40 min-h-[100px]" />
                const iso = dateToISO(day)
                const dayShifts = shiftsByDate[iso] || {}
                const morning = dayShifts['ochtend']
                const afternoon = dayShifts['middag']
                const isSelected = selectedDate === iso
                const isToday = iso === new Date().toISOString().split('T')[0]
                const dayPending = [morning, afternoon].filter(Boolean).reduce((n, s) =>
                  n + (s!.assigned_students || []).filter(a => a.status === 'pending').length, 0)
                const hasShifts = morning || afternoon

                return (
                  <button
                    key={iso}
                    onClick={() => setSelectedDate(isSelected ? null : iso)}
                    className={`p-2.5 sm:p-3 text-left transition-colors min-h-[100px] w-full ${
                      isSelected ? 'bg-dark/[0.06] ring-2 ring-inset ring-dark/20' : hasShifts ? 'hover:bg-gray-50' : 'cursor-default'
                    }`}
                  >
                    {/* Date number */}
                    <div className="flex items-center justify-between mb-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold ${
                        isToday
                          ? 'text-white'
                          : 'text-dark'
                      }`} style={isToday ? { backgroundColor: '#f87369' } : {}}>
                        {day.getDate()}
                      </div>
                      {dayPending > 0 && (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full leading-none">
                          {dayPending}
                        </span>
                      )}
                    </div>
                    {/* Shift blocks */}
                    <div className="space-y-1.5">
                      <ShiftBar shift={morning} label="AM" />
                      <ShiftBar shift={afternoon} label="PM" />
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Selected day panel */}
      {selectedDate && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between" style={{ backgroundColor: '#3c3c3b' }}>
            <p className="font-bold text-white capitalize text-sm">{formatDate(selectedDate)}</p>
            <button onClick={() => setSelectedDate(null)} className="text-white/50 hover:text-white text-xl leading-none">×</button>
          </div>

          {selectedDayShifts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 italic">Geen diensten op deze dag.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {selectedDayShifts.map(shift => {
                const pending = (shift.assigned_students || []).filter(a => a.status === 'pending')
                const approved = (shift.assigned_students || []).filter(a => a.status === 'approved')
                const isFull = shift.open_spots <= 0
                const isOchtend = shift.shift_type === 'ochtend'
                const unassigned = unassignedStudents(shift)

                return (
                  <div key={shift.id} className="px-5 py-5">
                    {/* Shift header */}
                    <div className="flex items-center gap-2 mb-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        isOchtend ? 'bg-orange-50 text-orange-500' : 'bg-indigo-50 text-indigo-500'
                      }`}>
                        {isOchtend ? 'Ochtend' : 'Middag'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} ({shift.duration_hours}u)
                      </span>
                      <span className={`ml-auto text-xs font-medium px-2.5 py-1 rounded-full ${
                        isFull ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
                      }`}>
                        {shift.assigned_count}/{shift.max_students} goedgekeurd
                      </span>
                    </div>

                    {/* Pending aanvragen */}
                    {pending.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                          Aanvragen ({pending.length})
                        </p>
                        <div className="space-y-2">
                          {pending.map(s => (
                            <div key={s.user_id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-amber-300" />
                                <span className="text-sm font-semibold text-dark">{s.full_name || s.email}</span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => approveAssignment(s.assignment_id)}
                                  disabled={processing === s.assignment_id}
                                  className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 bg-emerald-500 hover:bg-emerald-600"
                                >
                                  {processing === s.assignment_id ? '...' : 'Goedkeuren'}
                                </button>
                                <button
                                  onClick={() => rejectAssignment(s.assignment_id)}
                                  disabled={processing === s.assignment_id}
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                >
                                  Afwijzen
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Goedgekeurde studenten */}
                    {approved.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Ingeroosterd ({approved.length})</p>
                        <div className="space-y-2">
                          {approved.map(s => (
                            <div key={s.user_id} className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                <span className="text-sm font-semibold text-dark">{s.full_name || s.email}</span>
                              </div>
                              <button
                                onClick={() => removeAssignment(s.assignment_id)}
                                disabled={processing === s.assignment_id}
                                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-200 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50"
                              >
                                {processing === s.assignment_id ? '...' : 'Verwijderen'}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Direct inroosteren (als er nog plek is) */}
                    {!isFull && unassigned.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-gray-400 mb-2">Direct inroosteren</p>
                        <div className="flex flex-wrap gap-1.5">
                          {unassigned.map(student => (
                            <button
                              key={student.id}
                              onClick={() => directAssign(shift.id, student.id)}
                              disabled={processing === shift.id + student.id}
                              className="text-xs px-2.5 py-1.5 rounded-xl border font-semibold transition-colors disabled:opacity-50"
                              style={{ borderColor: '#d1d5db', color: '#6b7280', backgroundColor: '#f9fafb' }}
                            >
                              + {student.full_name || student.email.split('@')[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {isFull && pending.length === 0 && (
                      <p className="text-xs font-semibold text-emerald-600">Dienst is vol</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QuickApprovePanel({
  shifts, processing, onApprove, onReject, onApproveAll
}: {
  shifts: ShiftWithAssignments[]
  processing: string | null
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onApproveAll: (ids: string[]) => void
}) {
  const rows: { shift: ShiftWithAssignments; student: NonNullable<ShiftWithAssignments['assigned_students']>[number] }[] = []
  for (const s of [...shifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.shift_type.localeCompare(b.shift_type))) {
    for (const st of (s.assigned_students || []).filter(a => a.status === 'pending')) {
      rows.push({ shift: s, student: st })
    }
  }

  const SHIFT_DAYS_NL: Record<string, string> = {
    Monday: 'Maandag', Tuesday: 'Dinsdag', Wednesday: 'Woensdag',
    Thursday: 'Donderdag', Friday: 'Vrijdag', Saturday: 'Zaterdag',
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/60 flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-amber-700 uppercase tracking-widest">
          Snel goedkeuren — {rows.length} openstaand{rows.length === 1 ? '' : 'e'}
        </p>
        <button
          onClick={() => onApproveAll(rows.map(r => r.student.assignment_id))}
          disabled={processing !== null}
          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          Alles goedkeuren
        </button>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(({ shift, student }) => {
          const d = new Date(shift.shift_date + 'T00:00:00')
          const dayNl = SHIFT_DAYS_NL[d.toLocaleDateString('en-US', { weekday: 'long' })] || ''
          const dateStr = `${dayNl} ${d.getDate()} ${d.toLocaleDateString('nl-NL', { month: 'long' })}`
          const isOchtend = shift.shift_type === 'ochtend'
          return (
            <div key={student.assignment_id} className="flex items-center gap-4 px-5 py-3.5">
              {/* Date + type */}
              <div className="w-36 flex-shrink-0">
                <p className="text-xs font-semibold text-dark leading-tight">{dateStr}</p>
                <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mt-1 ${
                  isOchtend ? 'bg-orange-50 text-orange-500' : 'bg-indigo-50 text-indigo-500'
                }`}>
                  {isOchtend ? 'Ochtend' : 'Middag'} · {shift.start_time.slice(0, 5)}
                </span>
              </div>

              {/* Student */}
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full bg-amber-300 flex-shrink-0" />
                <p className="text-sm font-semibold text-dark truncate">
                  {student.full_name || student.email}
                </p>
              </div>

              {/* Capacity */}
              <p className="text-xs text-gray-400 hidden sm:block flex-shrink-0">
                {shift.assigned_count}/{shift.max_students}
              </p>

              {/* Actions */}
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => onApprove(student.assignment_id)}
                  disabled={processing === student.assignment_id}
                  className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  {processing === student.assignment_id ? '...' : 'Goedkeuren'}
                </button>
                <button
                  onClick={() => onReject(student.assignment_id)}
                  disabled={processing === student.assignment_id}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-50"
                >
                  Afwijzen
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ShiftBar({ shift, label }: { shift?: ShiftWithAssignments; label: string }) {
  if (!shift) return (
    <div className="h-6 rounded-md bg-gray-100/60 flex items-center px-2">
      <span className="text-[9px] text-gray-300 font-semibold">{label}</span>
    </div>
  )

  const pct = shift.max_students > 0 ? shift.assigned_count / shift.max_students : 0
  const pendingCount = (shift.assigned_students || []).filter(a => a.status === 'pending').length

  const bg = pct >= 1 ? '#d1fae5' : pct > 0 ? '#fef9c3' : '#fee2e2'
  const textColor = pct >= 1 ? '#065f46' : pct > 0 ? '#92400e' : '#9f1239'

  return (
    <div className="h-6 rounded-md flex items-center justify-between px-2 gap-1" style={{ backgroundColor: bg }}>
      <span className="text-[9px] font-bold" style={{ color: textColor }}>{label}</span>
      <div className="flex items-center gap-1 ml-auto">
        <span className="text-[10px] font-bold" style={{ color: textColor }}>
          {shift.assigned_count}/{shift.max_students}
        </span>
        {pendingCount > 0 && (
          <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1 rounded-sm leading-tight">
            +{pendingCount}
          </span>
        )}
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
