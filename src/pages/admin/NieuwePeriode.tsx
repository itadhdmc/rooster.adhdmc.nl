import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
    if (!includeOchtend && !includeMiddag) { setError('Selecteer minimaal één diensttype.'); return }
    setSaving(true)
    setError('')

    const { data: existing } = await supabase
      .from('roster_periods').select('id').eq('year', year).eq('month', month).single()

    if (existing) {
      setError(`Er bestaat al een periode voor ${monthLabel(year, month)}.`)
      setSaving(false)
      return
    }

    const { data: period, error: pErr } = await supabase
      .from('roster_periods')
      .insert({ year, month, availability_deadline: deadline || null, availability_open: true })
      .select().single()

    if (pErr || !period) { setError('Kon periode niet aanmaken: ' + (pErr?.message || 'onbekende fout')); setSaving(false); return }

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
    if (sErr) { setError('Diensten konden niet worden aangemaakt: ' + sErr.message); setSaving(false); return }

    navigate(`/admin/rooster/${period.id}`)
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/admin" className="text-sm font-medium text-gray-400 hover:text-dark transition-colors">← Terug</Link>
        <span className="text-gray-200">/</span>
        <h1 className="text-xl font-bold text-dark">Nieuwe periode</h1>
      </div>

      <div className="card p-6 space-y-6">
        {/* Maand/jaar */}
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Maand</label>
          <div className="flex gap-3">
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm flex-1 focus:outline-none focus:border-salmon-400"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{monthLabel(year, m)}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm w-28 focus:outline-none focus:border-salmon-400"
            >
              {[now.getFullYear(), now.getFullYear() + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{workdays.length} werkdagen in {monthLabel(year, month)}</p>
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
            Deadline beschikbaarheid <span className="normal-case font-normal">(optioneel)</span>
          </label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={e => setDeadline(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm w-full focus:outline-none focus:border-salmon-400"
          />
        </div>

        {/* Diensttypen */}
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Diensttypen</label>
          <div className="space-y-2.5">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors"
                style={{ borderColor: includeOchtend ? '#f87369' : '#d1d5db', backgroundColor: includeOchtend ? '#f87369' : 'white' }}
                onClick={() => setIncludeOchtend(!includeOchtend)}
              >
                {includeOchtend && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-semibold text-dark">Ochtenddienst</p>
                <p className="text-xs text-gray-400">08:30 – 12:30 (4u)</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors"
                style={{ borderColor: includeMiddag ? '#f87369' : '#d1d5db', backgroundColor: includeMiddag ? '#f87369' : 'white' }}
                onClick={() => setIncludeMiddag(!includeMiddag)}
              >
                {includeMiddag && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-semibold text-dark">Middagdienst</p>
                <p className="text-xs text-gray-400">12:00 – 17:30 (5,5u) — 30 min overlap</p>
              </div>
            </label>
          </div>
        </div>

        {/* Max studenten */}
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Studenten per dienst</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={10}
              value={maxStudents}
              onChange={e => setMaxStudents(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm w-20 focus:outline-none focus:border-salmon-400"
            />
            <span className="text-sm text-gray-400">student(en) per dienst</span>
          </div>
        </div>

        {/* Summary */}
        <div className="rounded-xl p-4 text-sm font-medium" style={{ backgroundColor: '#fff1f0', color: '#f87369' }}>
          {totalShifts} diensten worden aangemaakt voor {monthLabel(year, month)}
          {includeOchtend && includeMiddag && ' (ochtend + middag per werkdag)'}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>
        )}

        <button
          onClick={handleCreate}
          disabled={saving}
          className="w-full text-white py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-60"
          style={{ backgroundColor: '#f87369' }}
          onMouseEnter={e => !saving && (e.currentTarget.style.backgroundColor = '#e5574d')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#f87369')}
        >
          {saving ? 'Aanmaken...' : `Periode ${monthLabel(year, month)} aanmaken`}
        </button>
      </div>
    </div>
  )
}
