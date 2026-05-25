import { useEffect, useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ShiftWithAssignments, Profile, RosterPeriod, Availability } from '../../types'
import { formatDate, monthLabel, dateToISO, getWeeksInMonth } from '../../utils/dates'

export default function RoosterBeheer() {
  const { periodId } = useParams<{ periodId: string }>()
  const [period, setPeriod] = useState<RosterPeriod | null>(null)
  const [shifts, setShifts] = useState<ShiftWithAssignments[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])
  const [studentHours, setStudentHours] = useState<Record<string, number>>({})
  const [studentDates, setStudentDates] = useState<Record<string, Set<string>>>({})
  const [loading, setLoading] = useState(true)
  const [assigningShift, setAssigningShift] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  useEffect(() => { loadAll() }, [periodId])

  async function loadAll() {
    if (!periodId) return
    const [{ data: p }, { data: s }, { data: st }, { data: av }, { data: assignments }] = await Promise.all([
      supabase.from('roster_periods').select('*').eq('id', periodId).single(),
      supabase.from('shifts_with_assignments').select('*').eq('period_id', periodId).order('shift_date').order('shift_type'),
      supabase.from('profiles').select('*').eq('role', 'student').eq('active', true),
      supabase.from('availability').select('*').eq('period_id', periodId),
      supabase.from('assignments').select('*, shifts(duration_hours, period_id, shift_date)').eq('shifts.period_id', periodId),
    ])

    setPeriod(p)
    setShifts(s || [])
    setStudents(st || [])
    setAvailability(av || [])

    const hours: Record<string, number> = {}
    const dates: Record<string, Set<string>> = {}
    for (const a of assignments || []) {
      const shift = (a as any).shifts
      if (!shift || shift.period_id !== periodId) continue
      hours[a.user_id] = (hours[a.user_id] || 0) + shift.duration_hours
      if (!dates[a.user_id]) dates[a.user_id] = new Set()
      dates[a.user_id].add(shift.shift_date)
    }
    setStudentHours(hours)
    setStudentDates(dates)
    setLoading(false)
  }

  async function assignStudent(shiftId: string, userId: string) {
    setAssigningShift(shiftId)
    const { error } = await supabase.from('assignments').insert({ shift_id: shiftId, user_id: userId })
    if (error) alert('Fout bij inroosteren: ' + error.message)
    await loadAll()
    setAssigningShift(null)
  }

  async function removeAssignment(shiftId: string, userId: string) {
    await supabase.from('assignments').delete().eq('shift_id', shiftId).eq('user_id', userId)
    await loadAll()
  }

  function availableStudentsForShift(shift: ShiftWithAssignments): Profile[] {
    const availableIds = new Set(
      availability
        .filter(a => a.shift_date === shift.shift_date && a.shift_type === shift.shift_type)
        .map(a => a.user_id)
    )
    const assignedIds = new Set((shift.assigned_students || []).map(s => s.user_id))
    return students.filter(s => availableIds.has(s.id) && !assignedIds.has(s.id))
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

  if (loading) return <Spinner />
  if (!period) return <div className="text-red-500 p-4">Periode niet gevonden.</div>

  const totalShifts = shifts.length
  const filledShifts = shifts.filter(s => s.open_spots <= 0).length
  const openShifts = totalShifts - filledShifts
  const weeks = getWeeksInMonth(period.year, period.month)

  return (
    <div className="space-y-5">
      {/* Breadcrumb + title */}
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

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>Klik op een dag om in te roosteren:</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-green-500 inline-block" /> Vol</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-amber-400 inline-block" /> Gedeeltelijk</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#f87369' }} /> Leeg</span>
      </div>

      {/* Calendar grid */}
      <div className="card overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-5 border-b border-gray-100 bg-surface">
          {['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag'].map((d, i) => (
            <div key={d} className={`py-2 text-center text-xs font-bold text-gray-400 ${i < 4 ? 'border-r border-gray-100' : ''}`}>
              <span className="hidden sm:inline">{d}</span>
              <span className="sm:hidden">{d.slice(0, 2)}</span>
            </div>
          ))}
        </div>

        {/* Week rows */}
        <div className="divide-y divide-gray-100">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-5 divide-x divide-gray-100">
              {week.map((day, di) => {
                if (!day) {
                  return <div key={di} className="p-2 sm:p-3 bg-gray-50/50 min-h-[80px]" />
                }
                const iso = dateToISO(day)
                const dayShifts = shiftsByDate[iso] || {}
                const morning = dayShifts['ochtend']
                const afternoon = dayShifts['middag']
                const isSelected = selectedDate === iso
                const todayISO = new Date().toISOString().split('T')[0]
                const isToday = iso === todayISO

                return (
                  <button
                    key={iso}
                    onClick={() => setSelectedDate(isSelected ? null : iso)}
                    className={`p-2 sm:p-3 text-left transition-colors min-h-[80px] w-full ${
                      isSelected
                        ? 'bg-dark/5'
                        : 'hover:bg-surface'
                    }`}
                  >
                    <p className={`text-xs font-bold mb-2 ${isToday ? 'text-salmon-500' : 'text-dark'}`}>
                      {day.getDate()}
                    </p>
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
            <button
              onClick={() => setSelectedDate(null)}
              className="text-white/50 hover:text-white transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>

          {selectedDayShifts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 italic">Geen diensten op deze dag.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {selectedDayShifts.map(shift => {
                const available = availableStudentsForShift(shift)
                const isFull = shift.open_spots <= 0
                const isOchtend = shift.shift_type === 'ochtend'

                return (
                  <div key={shift.id} className="px-5 py-4">
                    {/* Shift type + time */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        isOchtend ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {isOchtend ? 'Ochtend' : 'Middag'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} ({shift.duration_hours}u)
                      </span>
                      <span className={`ml-auto text-xs font-bold px-2.5 py-1 rounded-full ${
                        isFull ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {shift.assigned_count}/{shift.max_students}
                      </span>
                    </div>

                    {/* Assigned */}
                    {shift.assigned_students && shift.assigned_students.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {shift.assigned_students.map(s => (
                          <div key={s.user_id} className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold"
                            style={{ backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1' }}>
                            <span>{s.full_name || s.email}</span>
                            <span className="opacity-50 font-normal">({studentHours[s.user_id] || 0}u)</span>
                            <button
                              onClick={() => removeAssignment(shift.id, s.user_id)}
                              className="opacity-40 hover:opacity-100 hover:text-red-500 transition-all font-bold ml-0.5"
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Available */}
                    {!isFull && (
                      <div>
                        {available.length === 0 ? (
                          <p className="text-xs text-gray-400 italic">Geen beschikbare studenten</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {available.map(student => {
                              const hours = studentHours[student.id] || 0
                              const overMax = hours >= student.contract_max_hours * 4
                              const hasConflict = studentDates[student.id]?.has(shift.shift_date) ?? false

                              if (hasConflict) return (
                                <span key={student.id}
                                  className="text-xs px-2.5 py-1 rounded-xl border font-medium cursor-not-allowed"
                                  style={{ borderColor: '#fca5a5', color: '#ef4444', backgroundColor: '#fff1f0' }}
                                  title="Al ingeroosterd op deze dag">
                                  🚫 {student.full_name || student.email.split('@')[0]}
                                </span>
                              )

                              return (
                                <button
                                  key={student.id}
                                  onClick={() => assignStudent(shift.id, student.id)}
                                  disabled={assigningShift === shift.id}
                                  className="text-xs px-2.5 py-1 rounded-xl border font-semibold transition-colors disabled:opacity-50"
                                  style={overMax
                                    ? { borderColor: '#fdba74', color: '#c2410c', backgroundColor: '#fff7ed' }
                                    : { borderColor: '#86efac', color: '#166534', backgroundColor: '#f0fdf4' }
                                  }
                                  title={`${hours}u deze maand${overMax ? ' ⚠️ boven contract max' : ''}`}
                                >
                                  + {student.full_name || student.email.split('@')[0]}
                                  {overMax && ' ⚠️'}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {isFull && (
                      <p className="text-xs font-semibold text-green-600">✓ Dienst is vol</p>
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

function ShiftBar({ shift, label }: { shift?: ShiftWithAssignments; label: string }) {
  if (!shift) return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-gray-300 w-4">{label}</span>
      <div className="h-1 rounded-full flex-1 bg-gray-100" />
    </div>
  )

  const pct = shift.max_students > 0 ? shift.assigned_count / shift.max_students : 0
  const color = pct >= 1 ? '#22c55e' : pct > 0 ? '#f59e0b' : '#f87369'

  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-gray-400 w-4">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[9px] text-gray-400">{shift.assigned_count}/{shift.max_students}</span>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#f87369', borderTopColor: 'transparent' }} />
    </div>
  )
}
