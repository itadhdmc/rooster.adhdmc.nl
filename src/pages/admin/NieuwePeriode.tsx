import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getWorkdaysInMonth, dateToISO, monthLabel } from '../../utils/dates'

const SHIFT_TEMPLATES = [
  { shift_type: 'ochtend' as const, start_time: '08:30', end_time: '12:30', duration_hours: 4 },
  { shift_type: 'middag' as const, start_time: '12:00', end_time: '17:30', duration_hours: 5.5 },
]

export default function NieuwePeriode() {
  const navigate = useNavigate()
  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [year, setYear] = useState(nextMonth.getFullYear())
  const [month, setMonth] = useState(nextMonth.getMonth() + 1)
  const [deadline, setDeadline] = useState('')
  const [includeOchtend, setIncludeOchtend] = useState(true)
  const [includeMiddag, setIncludeMiddag] = useState(true)
  const [maxStudents, setMaxStudents] = useState(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const workdays = getWorkdaysInMonth(year, month)
  const selectedTypes = SHIFT_TEMPLATES.filter(t =>
    (t.shift_type === 'ochtend' && includeOchtend) ||
    (t.shift_type === 'middag' && includeMiddag)
  )
  const totalShifts = workdays.length * selectedTypes.length

  async function handleCreate() {
    if (!includeOchtend && !includeMiddag) {
      setError('Selecteer minimaal één diensttype.')
      return
    }
    setSaving(true)
    setError('')

    // Check of periode al bestaat
    const { data: existing } = await supabase
      .from('roster_periods')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .single()

    if (existing) {
      setError(`Er bestaat al een periode voor ${monthLabel(year, month)}.`)
      setSaving(false)
      return
    }

    // Maak periode aan
    const { data: period, error: pErr } = await supabase
      .from('roster_periods')
      .insert({
        year,
        month,
        availability_deadline: deadline || null,
        availability_open: true,
      })
      .select()
      .single()

    if (pErr || !period) {
      setError('Kon periode niet aanmaken.')
      setSaving(false)
      return
    }

    // Maak diensten aan
    const shifts = []
    for (const day of workdays) {
      for (const template of selectedTypes) {
        shifts.push({
          period_id: period.id,
          shift_date: dateToISO(day),
          shift_type: template.shift_type,
          start_time: template.start_time,
          end_time: template.end_time,
          duration_hours: template.duration_hours,
          max_students: maxStudents,
        })
      }
    }

    const { error: sErr } = await supabase.from('shifts').insert(shifts)
    if (sErr) {
      setError('Periode aangemaakt maar diensten konden niet worden aangemaakt.')
      setSaving(false)
      return
    }

    navigate(`/admin/rooster/${period.id}`)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nieuwe roosterperiode</h1>
        <p className="text-gray-500 text-sm mt-1">Maak een nieuwe maand aan en genereer automatisch alle werkdagdiensten.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Maand/jaar */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Maand</label>
          <div className="flex gap-3">
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{monthLabel(year, m)}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-28"
            >
              {[now.getFullYear(), now.getFullYear() + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500 mt-1">{workdays.length} werkdagen in {monthLabel(year, month)}</p>
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Deadline beschikbaarheid <span className="text-gray-400">(optioneel)</span>
          </label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={e => setDeadline(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
          />
        </div>

        {/* Diensttypen */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Diensttypen</label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={includeOchtend} onChange={e => setIncludeOchtend(e.target.checked)} className="w-4 h-4 text-blue-600" />
              <div>
                <span className="text-sm font-medium">Ochtenddienst</span>
                <span className="text-xs text-gray-500 ml-2">08:30 – 12:30 (4u)</span>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={includeMiddag} onChange={e => setIncludeMiddag(e.target.checked)} className="w-4 h-4 text-blue-600" />
              <div>
                <span className="text-sm font-medium">Middagdienst</span>
                <span className="text-xs text-gray-500 ml-2">12:00 – 17:30 (5,5u) — 30 min overlap</span>
              </div>
            </label>
          </div>
        </div>

        {/* Max studenten per dienst */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Studenten per dienst</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={10}
              value={maxStudents}
              onChange={e => setMaxStudents(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-24"
            />
            <span className="text-sm text-gray-500">student(en) per dienst</span>
          </div>
        </div>

        {/* Samenvatting */}
        <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
          Er worden <strong>{totalShifts} diensten</strong> aangemaakt voor {monthLabel(year, month)}.
          {includeOchtend && includeMiddag && ' (ochtend + middag per werkdag)'}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
        )}

        <button
          onClick={handleCreate}
          disabled={saving}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
        >
          {saving ? 'Aanmaken...' : `Periode ${monthLabel(year, month)} aanmaken`}
        </button>
      </div>
    </div>
  )
}
