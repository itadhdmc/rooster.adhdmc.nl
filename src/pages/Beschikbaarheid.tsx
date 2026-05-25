import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { RosterPeriod, Availability, ShiftType } from '../types'
import { getWorkdaysInMonth, dateToISO, monthLabel } from '../utils/dates'
import { format } from 'date-fns'
import { nl } from 'date-fns/locale'

const SHIFT_INFO = {
  ochtend: { label: 'Ochtend', time: '08:30 – 12:30', hours: 4 },
  middag:  { label: 'Middag',  time: '12:00 – 17:30', hours: 5.5 },
}

export default function Beschikbaarheid() {
  const { profile } = useAuth()
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null)
  const [availability, setAvailability] = useState<Record<string, ShiftType[]>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadPeriods() }, [])
  useEffect(() => { if (selectedPeriod && profile) loadAvailability() }, [selectedPeriod, profile])

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

  async function loadAvailability() {
    const { data } = await supabase
      .from('availability')
      .select('*')
      .eq('user_id', profile!.id)
      .eq('period_id', selectedPeriod!.id)

    const map: Record<string, ShiftType[]> = {}
    for (const a of data || []) {
      if (!map[a.shift_date]) map[a.shift_date] = []
      map[a.shift_date].push(a.shift_type as ShiftType)
    }
    setAvailability(map)
  }

  function toggleAvailability(date: string, type: ShiftType) {
    setAvailability(prev => {
      const current = prev[date] || []
      const updated = current.includes(type)
        ? current.filter(t => t !== type)
        : [...current, type]
      return { ...prev, [date]: updated }
    })
    setSaved(false)
  }

  async function handleSave() {
    if (!selectedPeriod || !profile) return
    setSaving(true)

    await supabase.from('availability').delete()
      .eq('user_id', profile.id).eq('period_id', selectedPeriod.id)

    const inserts: Omit<Availability, 'id' | 'submitted_at'>[] = []
    for (const [date, types] of Object.entries(availability)) {
      for (const type of types) {
        inserts.push({ user_id: profile.id, period_id: selectedPeriod.id, shift_date: date, shift_type: type })
      }
    }
    if (inserts.length > 0) await supabase.from('availability').insert(inserts)

    setSaving(false)
    setSaved(true)
    await loadAvailability()
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
        <h2 className="text-lg font-bold text-dark">Geen open inschrijfronde</h2>
        <p className="text-gray-400 text-sm mt-2">Er is momenteel geen actieve periode om beschikbaarheid in te vullen.</p>
      </div>
    )
  }

  const workdays = selectedPeriod ? getWorkdaysInMonth(selectedPeriod.year, selectedPeriod.month) : []
  const totalSelected = Object.values(availability).flat().length
  const totalHours = Object.values(availability).flat().reduce((sum, type) => sum + SHIFT_INFO[type].hours, 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">Beschikbaarheid</h1>
          <p className="text-gray-400 text-sm mt-0.5">Kies de diensten waarbij je beschikbaar bent.</p>
        </div>
        {periods.length > 1 && (
          <select
            className="border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-medium text-dark focus:outline-none focus:border-salmon-400"
            value={selectedPeriod?.id}
            onChange={e => setSelectedPeriod(periods.find(p => p.id === e.target.value) || null)}
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>{monthLabel(p.year, p.month)}</option>
            ))}
          </select>
        )}
      </div>

      {/* Deadline */}
      {selectedPeriod?.availability_deadline && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-sm text-amber-800">
          <span className="text-lg">⏰</span>
          <span>
            Deadline:{' '}
            <strong>
              {new Date(selectedPeriod.availability_deadline).toLocaleDateString('nl-NL', {
                day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
              })}
            </strong>
          </span>
        </div>
      )}

      {/* Legenda */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2 text-sm">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <span className="font-semibold text-amber-800">Ochtend</span>
          <span className="text-amber-600">08:30 – 12:30 (4u)</span>
        </div>
        <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-xl px-3.5 py-2 text-sm">
          <div className="w-2.5 h-2.5 rounded-full bg-purple-400" />
          <span className="font-semibold text-purple-800">Middag</span>
          <span className="text-purple-600">12:00 – 17:30 (5,5u)</span>
        </div>
      </div>

      {/* Calendar */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-dark text-sm">
            {selectedPeriod && monthLabel(selectedPeriod.year, selectedPeriod.month)}
          </h2>
          <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
            {totalSelected} geselecteerd · {totalHours}u
          </span>
        </div>

        <div className="divide-y divide-gray-50">
          {workdays.map(day => {
            const iso = dateToISO(day)
            const selected = availability[iso] || []
            const dayName = format(day, 'EEEE', { locale: nl })
            const dayNum = format(day, 'd MMMM', { locale: nl })

            return (
              <div key={iso} className="px-5 py-3.5 flex items-center gap-4">
                <div className="w-28 flex-shrink-0">
                  <p className="text-sm font-semibold text-dark capitalize">{dayName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{dayNum}</p>
                </div>
                <div className="flex gap-2">
                  {(Object.entries(SHIFT_INFO) as [ShiftType, typeof SHIFT_INFO.ochtend][]).map(([type, info]) => {
                    const isSelected = selected.includes(type)
                    const isOchtend = type === 'ochtend'
                    return (
                      <button
                        key={type}
                        onClick={() => toggleAvailability(iso, type)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border-2 transition-all ${
                          isSelected
                            ? isOchtend
                              ? 'bg-amber-400 border-amber-400 text-white'
                              : 'bg-purple-500 border-purple-500 text-white'
                            : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                        }`}
                      >
                        {info.label}{isSelected && ' ✓'}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Save bar */}
      <div className="card p-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          <span className="font-bold text-dark">{totalSelected}</span> diensten ·{' '}
          <span className="font-bold text-dark">{totalHours}</span> uur geselecteerd
        </p>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-60 ${
            saved
              ? 'bg-green-500 text-white'
              : 'text-white'
          }`}
          style={saved ? undefined : { backgroundColor: '#f87369' }}
        >
          {saving ? 'Opslaan...' : saved ? '✓ Opgeslagen' : 'Opslaan'}
        </button>
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
