import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Shift, Assignment } from '../types'
import { formatDate, monthLabel } from '../utils/dates'

interface AssignmentWithShift extends Assignment {
  shift: Shift
}

export default function MijnRooster() {
  const { profile } = useAuth()
  const [assignments, setAssignments] = useState<AssignmentWithShift[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    if (!profile) return
    loadAssignments()
  }, [profile, selectedMonth])

  async function loadAssignments() {
    setLoading(true)
    const [year, month] = selectedMonth.split('-').map(Number)
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const end = `${year}-${String(month).padStart(2, '0')}-31`

    const { data } = await supabase
      .from('assignments')
      .select('*, shifts(*)')
      .eq('user_id', profile!.id)
      .gte('shifts.shift_date', start)
      .lte('shifts.shift_date', end)
      .order('shifts(shift_date)', { ascending: true })

    const enriched = (data || [])
      .filter(a => (a as any).shifts)
      .map(a => ({ ...a, shift: (a as any).shifts as Shift }))

    setAssignments(enriched)
    setLoading(false)
  }

  const totalHours = assignments.reduce((sum, a) => sum + a.shift.duration_hours, 0)
  const [year, month] = selectedMonth.split('-').map(Number)

  function generateMonthOptions() {
    const options = []
    const now = new Date()
    for (let i = -1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      options.push({ value, label: monthLabel(d.getFullYear(), d.getMonth() + 1) })
    }
    return options
  }

  const shiftBadge = (type: string) =>
    type === 'ochtend'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-purple-100 text-purple-700'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mijn Rooster</h1>
          <p className="text-gray-500 text-sm mt-1">Jouw ingeplande diensten</p>
        </div>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
        >
          {generateMonthOptions().map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Samenvatting */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
          <p className="text-2xl font-bold text-blue-700">{assignments.length}</p>
          <p className="text-xs text-blue-600 mt-1">Diensten gepland</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 border border-green-100">
          <p className="text-2xl font-bold text-green-700">{totalHours}u</p>
          <p className="text-xs text-green-600 mt-1">Totaal uren</p>
        </div>
        <div className={`rounded-xl p-4 border ${
          totalHours > (profile?.contract_max_hours || 16) * 4
            ? 'bg-red-50 border-red-100'
            : 'bg-gray-50 border-gray-100'
        }`}>
          <p className={`text-2xl font-bold ${
            totalHours > (profile?.contract_max_hours || 16) * 4 ? 'text-red-600' : 'text-gray-700'
          }`}>
            {profile?.contract_max_hours}u/week
          </p>
          <p className="text-xs text-gray-500 mt-1">Contract max</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : assignments.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-600 font-medium">Geen diensten in {monthLabel(year, month)}</p>
          <p className="text-gray-400 text-sm mt-1">Je bent nog niet ingeroosterd voor deze maand.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {assignments.map(({ shift, assigned_at }) => (
              <div key={shift.id} className="px-4 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 capitalize">{formatDate(shift.shift_date)}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                    <span className="mx-1">·</span>
                    {shift.duration_hours} uur
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Ingepland op {new Date(assigned_at).toLocaleDateString('nl-NL')}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${shiftBadge(shift.shift_type)}`}>
                    {shift.shift_type}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
