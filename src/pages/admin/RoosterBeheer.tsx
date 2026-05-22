import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ShiftWithAssignments, Profile, RosterPeriod, Availability } from '../../types'
import { formatDate, monthLabel } from '../../utils/dates'

export default function RoosterBeheer() {
  const { periodId } = useParams<{ periodId: string }>()
  const [period, setPeriod] = useState<RosterPeriod | null>(null)
  const [shifts, setShifts] = useState<ShiftWithAssignments[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])
  const [studentHours, setStudentHours] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [assigningShift, setAssigningShift] = useState<string | null>(null)

  useEffect(() => { loadAll() }, [periodId])

  async function loadAll() {
    if (!periodId) return
    const [{ data: p }, { data: s }, { data: st }, { data: av }, { data: assignments }] = await Promise.all([
      supabase.from('roster_periods').select('*').eq('id', periodId).single(),
      supabase.from('shifts_with_assignments').select('*').eq('period_id', periodId).order('shift_date').order('shift_type'),
      supabase.from('profiles').select('*').eq('role', 'student').eq('active', true),
      supabase.from('availability').select('*').eq('period_id', periodId),
      supabase.from('assignments').select('*, shifts(duration_hours, period_id)').eq('shifts.period_id', periodId),
    ])

    setPeriod(p)
    setShifts(s || [])
    setStudents(st || [])
    setAvailability(av || [])

    // Bereken uren per student voor deze periode
    const hours: Record<string, number> = {}
    for (const a of assignments || []) {
      const shift = (a as any).shifts
      if (!shift || shift.period_id !== periodId) continue
      hours[a.user_id] = (hours[a.user_id] || 0) + shift.duration_hours
    }
    setStudentHours(hours)

    setLoading(false)
  }

  async function assignStudent(shiftId: string, userId: string) {
    setAssigningShift(shiftId)
    const { error } = await supabase.from('assignments').insert({
      shift_id: shiftId,
      user_id: userId,
    })
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

  if (loading) return <Spinner />
  if (!period) return <div className="text-red-500">Periode niet gevonden.</div>

  const grouped = shifts.reduce<Record<string, ShiftWithAssignments[]>>((acc, s) => {
    if (!acc[s.shift_date]) acc[s.shift_date] = []
    acc[s.shift_date].push(s)
    return acc
  }, {})

  const totalShifts = shifts.length
  const filledShifts = shifts.filter(s => s.open_spots <= 0).length
  const openShifts = totalShifts - filledShifts

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/admin" className="text-blue-600 text-sm hover:underline">← Terug</Link>
        <h1 className="text-2xl font-bold text-gray-900">{monthLabel(period.year, period.month)}</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-700">{totalShifts}</p>
          <p className="text-xs text-gray-500 mt-1">Totaal diensten</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-100 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{filledShifts}</p>
          <p className="text-xs text-green-600 mt-1">Ingevuld</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{openShifts}</p>
          <p className="text-xs text-red-500 mt-1">Open plekken</p>
        </div>
      </div>

      {/* Per dag */}
      <div className="space-y-3">
        {Object.entries(grouped).map(([date, dayShifts]) => (
          <div key={date} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-2">
              <p className="font-medium text-gray-900 capitalize text-sm">{formatDate(date)}</p>
            </div>
            <div className="divide-y divide-gray-50">
              {dayShifts.map(shift => {
                const available = availableStudentsForShift(shift)
                const isFull = shift.open_spots <= 0
                return (
                  <div key={shift.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            shift.shift_type === 'ochtend' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {shift.shift_type === 'ochtend' ? 'Ochtend' : 'Middag'}
                          </span>
                          <span className="text-xs text-gray-500">
                            {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} ({shift.duration_hours}u)
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            isFull ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {shift.assigned_count}/{shift.max_students}
                          </span>
                        </div>

                        {/* Toegewezen studenten */}
                        {shift.assigned_students && shift.assigned_students.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {shift.assigned_students.map(s => (
                              <div key={s.user_id} className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1">
                                <span className="text-xs font-medium text-blue-800">
                                  {s.full_name || s.email}
                                </span>
                                <span className="text-xs text-blue-500">
                                  ({studentHours[s.user_id] || 0}u/maand)
                                </span>
                                <button
                                  onClick={() => removeAssignment(shift.id, s.user_id)}
                                  className="text-blue-400 hover:text-red-500 transition-colors ml-1"
                                  title="Verwijder"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Beschikbare studenten */}
                        {!isFull && available.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {available.map(student => {
                              const hours = studentHours[student.id] || 0
                              const overMax = hours >= student.contract_max_hours * 4
                              return (
                                <button
                                  key={student.id}
                                  onClick={() => assignStudent(shift.id, student.id)}
                                  disabled={assigningShift === shift.id}
                                  className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                                    overMax
                                      ? 'border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100'
                                      : 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                                  } disabled:opacity-50`}
                                  title={overMax ? `Let op: ${hours}u in maand (boven max)` : `${hours}u in maand`}
                                >
                                  + {student.full_name || student.email.split('@')[0]}
                                  {overMax && ' ⚠️'}
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {!isFull && available.length === 0 && (
                          <p className="text-xs text-gray-400 italic">Geen beschikbare studenten</p>
                        )}
                      </div>
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
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
