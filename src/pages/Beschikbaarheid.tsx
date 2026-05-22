import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { RosterPeriod, Availability, ShiftType } from '../types'
import { getWorkdaysInMonth, dateToISO, monthLabel } from '../utils/dates'
import { format } from 'date-fns'
import { nl } from 'date-fns/locale'

const SHIFT_INFO = {
  ochtend: { label: 'Ochtend', time: '08:30 – 12:30', hours: 4, color: 'amber' },
  middag: { label: 'Middag', time: '12:00 – 17:30', hours: 5.5, color: 'purple' },
}

export default function Beschikbaarheid() {
  const { profile } = useAuth()
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<RosterPeriod | null>(null)
  const [availability, setAvailability] = useState<Record<string, ShiftType[]>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPeriods()
  }, [])

  useEffect(() => {
    if (selectedPeriod && profile) loadAvailability()
  }, [selectedPeriod, profile])

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

    // Verwijder oude beschikbaarheid voor deze periode
    await supabase
      .from('availability')
      .delete()
      .eq('user_id', profile.id)
      .eq('period_id', selectedPeriod.id)

    // Voeg nieuwe in
    const inserts: Omit<Availability, 'id' | 'submitted_at'>[] = []
    for (const [date, types] of Object.entries(availability)) {
      for (const type of types) {
        inserts.push({
          user_id: profile.id,
          period_id: selectedPeriod.id,
          shift_date: date,
          shift_type: type,
        })
      }
    }

    if (inserts.length > 0) {
      await supabase.from('availability').insert(inserts)
    }

    setSaving(false)
    setSaved(true)
    await loadAvailability()
  }

  if (loading) return <Spinner />

  if (periods.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">📅</div>
        <h2 className="text-xl font-semibold text-gray-700">Geen open inschrijfronde</h2>
        <p className="text-gray-500 mt-2">Er is momenteel geen actieve periode om beschikbaarheid in te vullen.</p>
      </div>
    )
  }

  const workdays = selectedPeriod ? getWorkdaysInMonth(selectedPeriod.year, selectedPeriod.month) : []
  const totalSelected = Object.values(availability).flat().length
  const totalHours = Object.values(availability).flat()
    .reduce((sum, type) => sum + SHIFT_INFO[type].hours, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Beschikbaarheid opgeven</h1>
          <p className="text-gray-500 text-sm mt-1">Selecteer de diensten waarbij je beschikbaar bent.</p>
        </div>
        {periods.length > 1 && (
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={selectedPeriod?.id}
            onChange={e => setSelectedPeriod(periods.find(p => p.id === e.target.value) || null)}
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>{monthLabel(p.year, p.month)}</option>
            ))}
          </select>
        )}
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(SHIFT_INFO).map(([type, info]) => (
          <div key={type} className={`flex items-center gap-2 bg-${info.color}-50 border border-${info.color}-200 rounded-lg px-3 py-2 text-sm`}>
            <div className={`w-3 h-3 rounded-full bg-${info.color}-400`} />
            <span className="font-medium">{info.label}</span>
            <span className="text-gray-500">{info.time} ({info.hours}u)</span>
          </div>
        ))}
      </div>

      {/* Deadline waarschuwing */}
      {selectedPeriod?.availability_deadline && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-800">
          ⏰ Deadline: {new Date(selectedPeriod.availability_deadline).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* Kalender */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            {selectedPeriod && monthLabel(selectedPeriod.year, selectedPeriod.month)}
          </h2>
          <span className="text-sm text-gray-500">
            {totalSelected} dienst{totalSelected !== 1 ? 'en' : ''} geselecteerd ({totalHours}u)
          </span>
        </div>

        <div className="divide-y divide-gray-100">
          {workdays.map(day => {
            const iso = dateToISO(day)
            const selected = availability[iso] || []
            const dayName = format(day, 'EEEE', { locale: nl })
            const dayNum = format(day, 'd MMMM', { locale: nl })

            return (
              <div key={iso} className="px-4 py-3 flex items-center gap-4">
                <div className="w-32 flex-shrink-0">
                  <p className="text-sm font-medium text-gray-900 capitalize">{dayName}</p>
                  <p className="text-xs text-gray-500">{dayNum}</p>
                </div>
                <div className="flex gap-2">
                  {(Object.entries(SHIFT_INFO) as [ShiftType, typeof SHIFT_INFO.ochtend][]).map(([type, info]) => {
                    const isSelected = selected.includes(type)
                    return (
                      <button
                        key={type}
                        onClick={() => toggleAvailability(iso, type)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${
                          isSelected
                            ? type === 'ochtend'
                              ? 'bg-amber-400 border-amber-400 text-white'
                              : 'bg-purple-500 border-purple-500 text-white'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        {info.label}
                        {isSelected && ' ✓'}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Opslaan */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm text-gray-600">
          <span className="font-medium">{totalSelected}</span> diensten geselecteerd ·{' '}
          <span className="font-medium">{totalHours}</span> uur totaal
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2 rounded-lg font-medium text-sm transition-colors ${
            saved
              ? 'bg-green-500 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          } disabled:opacity-60`}
        >
          {saving ? 'Opslaan...' : saved ? '✓ Opgeslagen' : 'Beschikbaarheid opslaan'}
        </button>
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
