import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { RosterPeriod, Availability, Profile } from '../../types'
import { getWorkdaysInMonth, dateToISO, monthLabel, formatDate } from '../../utils/dates'

export default function BeschikbaarheidOverzicht() {
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null)
  const [availability, setAvailability] = useState<Availability[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('roster_periods').select('*').order('year').order('month').then(({ data }) => {
      setPeriods(data || [])
      if (data?.length) setSelectedPeriod(data[data.length - 1])
      setLoading(false)
    })
    supabase.from('profiles').select('*').eq('role', 'student').eq('active', true).then(({ data }) => {
      setStudents(data || [])
    })
  }, [])

  useEffect(() => {
    if (!selectedPeriod) return
    supabase.from('availability').select('*').eq('period_id', selectedPeriod.id).then(({ data }) => {
      setAvailability(data || [])
    })
  }, [selectedPeriod])

  if (loading) return <Spinner />

  const workdays = selectedPeriod ? getWorkdaysInMonth(selectedPeriod.year, selectedPeriod.month) : []

  function studentsForDate(date: string, type: 'ochtend' | 'middag') {
    return availability
      .filter(a => a.shift_date === date && a.shift_type === type)
      .map(a => students.find(s => s.id === a.user_id))
      .filter(Boolean) as Profile[]
  }

  const totalByStudent = students.map(s => ({
    student: s,
    ochtend: availability.filter(a => a.user_id === s.id && a.shift_type === 'ochtend').length,
    middag:  availability.filter(a => a.user_id === s.id && a.shift_type === 'middag').length,
    total:   availability.filter(a => a.user_id === s.id).length,
  })).filter(s => s.total > 0).sort((a, b) => b.total - a.total)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">Beschikbaarheid</h1>
          <p className="text-gray-400 text-sm mt-0.5">Overzicht per student en per dag</p>
        </div>
        {periods.length > 0 && (
          <select
            className="border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-medium text-dark focus:outline-none focus:border-salmon-400"
            value={selectedPeriod?.id}
            onChange={e => setSelectedPeriod(periods.find(p => p.id === e.target.value) || null)}
          >
            {periods.map(p => <option key={p.id} value={p.id}>{monthLabel(p.year, p.month)}</option>)}
          </select>
        )}
      </div>

      {/* Per student */}
      {totalByStudent.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Per student</p>
          <div className="card divide-y divide-gray-50">
            {totalByStudent.map(({ student, ochtend, middag, total }) => (
              <div key={student.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: '#3c3c3b' }}>
                    {(student.full_name || student.email)[0].toUpperCase()}
                  </div>
                  <p className="text-sm font-semibold text-dark">{student.full_name || student.email}</p>
                </div>
                <div className="flex items-center gap-2 text-xs flex-shrink-0">
                  <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-semibold">{ochtend}× ochtend</span>
                  <span className="bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full font-semibold">{middag}× middag</span>
                  <span className="text-gray-400 font-medium">{total} totaal</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per dag */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Per dag</p>
        <div className="space-y-2">
          {workdays.map(day => {
            const iso = dateToISO(day)
            const ochStudents = studentsForDate(iso, 'ochtend')
            const midStudents = studentsForDate(iso, 'middag')
            if (ochStudents.length === 0 && midStudents.length === 0) return null
            return (
              <div key={iso} className="card px-5 py-4">
                <p className="text-sm font-bold text-dark mb-3 capitalize">{formatDate(iso)}</p>
                <div className="flex flex-wrap gap-6">
                  {ochStudents.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-600 mb-1.5">Ochtend ({ochStudents.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ochStudents.map(s => (
                          <span key={s.id} className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-1 rounded-lg font-medium">
                            {s.full_name || s.email.split('@')[0]}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {midStudents.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-purple-600 mb-1.5">Middag ({midStudents.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {midStudents.map(s => (
                          <span key={s.id} className="text-xs bg-purple-50 border border-purple-200 text-purple-800 px-2.5 py-1 rounded-lg font-medium">
                            {s.full_name || s.email.split('@')[0]}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
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
