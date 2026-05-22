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
    middag: availability.filter(a => a.user_id === s.id && a.shift_type === 'middag').length,
    total: availability.filter(a => a.user_id === s.id).length,
  })).filter(s => s.total > 0).sort((a, b) => b.total - a.total)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Beschikbaarheid overzicht</h1>
        {periods.length > 0 && (
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={selectedPeriod?.id}
            onChange={e => setSelectedPeriod(periods.find(p => p.id === e.target.value) || null)}
          >
            {periods.map(p => <option key={p.id} value={p.id}>{monthLabel(p.year, p.month)}</option>)}
          </select>
        )}
      </div>

      {/* Per student samenvatting */}
      {totalByStudent.length > 0 && (
        <div>
          <h2 className="font-semibold text-gray-700 text-sm mb-2">Per student</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {totalByStudent.map(({ student, ochtend, middag, total }) => (
              <div key={student.id} className="px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">{student.full_name || student.email}</p>
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{ochtend}× ochtend</span>
                  <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{middag}× middag</span>
                  <span className="font-semibold">{total} totaal</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per dag */}
      <div>
        <h2 className="font-semibold text-gray-700 text-sm mb-2">Per dag</h2>
        <div className="space-y-2">
          {workdays.map(day => {
            const iso = dateToISO(day)
            const ochStudents = studentsForDate(iso, 'ochtend')
            const midStudents = studentsForDate(iso, 'middag')
            if (ochStudents.length === 0 && midStudents.length === 0) return null
            return (
              <div key={iso} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-sm font-semibold text-gray-900 mb-2 capitalize">{formatDate(iso)}</p>
                <div className="flex flex-wrap gap-4">
                  {ochStudents.length > 0 && (
                    <div>
                      <p className="text-xs text-amber-600 font-medium mb-1">Ochtend ({ochStudents.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {ochStudents.map(s => (
                          <span key={s.id} className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-lg">
                            {s.full_name || s.email.split('@')[0]}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {midStudents.length > 0 && (
                    <div>
                      <p className="text-xs text-purple-600 font-medium mb-1">Middag ({midStudents.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {midStudents.map(s => (
                          <span key={s.id} className="text-xs bg-purple-50 border border-purple-200 text-purple-800 px-2 py-0.5 rounded-lg">
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
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
