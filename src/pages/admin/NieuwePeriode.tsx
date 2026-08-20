import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getWorkdaysInMonth, getRosterDaysInMonth, isSaturday, dateToISO, monthLabel } from '../../utils/dates'
import { useSettings, maxStudentsFor } from '../../hooks/useSettings'
import { hoursBetween } from '../../utils/shiftTimes'

const DAY_PLURAL = ['', 'maandagen', 'dinsdagen', 'woensdagen', 'donderdagen', 'vrijdagen', 'zaterdagen', 'zondagen']

export default function NieuwePeriode() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [year, setYear] = useState(nextMonth.getFullYear())
  const [month, setMonth] = useState(nextMonth.getMonth() + 1)
  const [deadline, setDeadline] = useState('')
  const [includeOchtend, setIncludeOchtend] = useState(true)
  const [includeMiddag, setIncludeMiddag] = useState(true)
  const [maxStudents, setMaxStudents] = useState(settings.default_max_students)
  const [includeSaturday, setIncludeSaturday] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setMaxStudents(settings.default_max_students) }, [settings.default_max_students])

  // Diensttypes met instelbare tijden (uit app_settings).
  const shiftTemplates = settings.shift_types.map(t => ({
    shift_type: t.key,
    label: t.label,
    start_time: t.start,
    end_time: t.end,
    duration_hours: hoursBetween(t.start, t.end),
  }))

  const days = includeSaturday ? getRosterDaysInMonth(year, month) : getWorkdaysInMonth(year, month)
  const workdays = getWorkdaysInMonth(year, month)
  const saturdays = days.filter(isSaturday)
  const selectedTypes = shiftTemplates.filter(t =>
    (t.shift_type === 'ochtend' && includeOchtend) ||
    (t.shift_type === 'middag' && includeMiddag)
  )
  const totalShifts = days.length * selectedTypes.length
  const singleStaffLabel = settings.single_staff_weekdays
    .filter(d => d !== 6 || includeSaturday)
    .map(d => DAY_PLURAL[d]).join(' en ')

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
    for (const day of days) {
      for (const template of selectedTypes) {
        shifts.push({
          period_id: period.id,
          shift_date: dateToISO(day),
          shift_type: template.shift_type,
          start_time: template.start_time,
          end_time: template.end_time,
          duration_hours: template.duration_hours,
          // Eénpersoonsdagen (instelbaar) altijd max 1.
          max_students: maxStudentsFor(settings, day) === 1 ? 1 : maxStudents,
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
          <p className="text-xs text-gray-400 mt-1.5">
            {workdays.length} werkdagen{includeSaturday && saturdays.length > 0 ? ` + ${saturdays.length} zaterdagen` : ''} in {monthLabel(year, month)}
          </p>
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
                style={{ borderColor: includeOchtend ? 'var(--color-primary)' : '#d1d5db', backgroundColor: includeOchtend ? 'var(--color-primary)' : 'white' }}
                onClick={() => setIncludeOchtend(!includeOchtend)}
              >
                {includeOchtend && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-semibold text-dark">{shiftTemplates[0]?.label || 'Ochtend'}dienst</p>
                <p className="text-xs text-gray-400">
                  {shiftTemplates[0] ? `${shiftTemplates[0].start_time} – ${shiftTemplates[0].end_time} (${String(shiftTemplates[0].duration_hours).replace('.', ',')}u)` : ''}
                </p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors"
                style={{ borderColor: includeMiddag ? 'var(--color-primary)' : '#d1d5db', backgroundColor: includeMiddag ? 'var(--color-primary)' : 'white' }}
                onClick={() => setIncludeMiddag(!includeMiddag)}
              >
                {includeMiddag && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-semibold text-dark">{shiftTemplates[1]?.label || 'Middag'}dienst</p>
                <p className="text-xs text-gray-400">
                  {shiftTemplates[1] ? `${shiftTemplates[1].start_time} – ${shiftTemplates[1].end_time} (${String(shiftTemplates[1].duration_hours).replace('.', ',')}u)` : ''}
                </p>
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
          <p className="text-xs text-gray-400 mt-1.5">
            {singleStaffLabel ? `${singleStaffLabel.charAt(0).toUpperCase()}${singleStaffLabel.slice(1)} zijn altijd voor maar 1 persoon (instelbaar via Instellingen).` : 'Geen éénpersoonsdagen ingesteld.'}
          </p>
        </div>

        {/* Zaterdag */}
        <div>
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Zaterdag</label>
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors"
              style={{ borderColor: includeSaturday ? 'var(--color-primary)' : '#d1d5db', backgroundColor: includeSaturday ? 'var(--color-primary)' : 'white' }}
              onClick={() => setIncludeSaturday(!includeSaturday)}
            >
              {includeSaturday && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <div>
              <p className="text-sm font-semibold text-dark">Zaterdagen meenemen</p>
              <p className="text-xs text-gray-400">Altijd maar 1 student per zaterdagdienst</p>
            </div>
          </label>
        </div>

        {/* Summary */}
        <div className="rounded-xl p-4 text-sm font-medium" style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}>
          {totalShifts} diensten worden aangemaakt voor {monthLabel(year, month)}
          {includeOchtend && includeMiddag && ' (ochtend + middag per dag)'}
          {singleStaffLabel ? `. ${singleStaffLabel.charAt(0).toUpperCase()}${singleStaffLabel.slice(1)} krijgen max 1 persoon.` : '.'}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>
        )}

        <button
          onClick={handleCreate}
          disabled={saving}
          className="w-full text-white py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-60"
          style={{ backgroundColor: 'var(--color-primary)' }}
          onMouseEnter={e => !saving && (e.currentTarget.style.backgroundColor = 'var(--color-primary-600)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-primary)')}
        >
          {saving ? 'Aanmaken...' : `Periode ${monthLabel(year, month)} aanmaken`}
        </button>
      </div>
    </div>
  )
}
