import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { getGoogleToken } from '../lib/auth'
import { createCalendarEvent, deleteCalendarEvent } from '../lib/calendar'
import { Shift, Assignment } from '../types'
import { formatDate, monthLabel } from '../utils/dates'

interface AssignmentWithShift extends Assignment {
  shift: Shift
}

export default function MijnRooster() {
  const { profile } = useAuth()
  const [assignments, setAssignments] = useState<AssignmentWithShift[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<Record<string, boolean>>({})
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [googleToken, setGoogleToken] = useState<string | null>(null)
  const [tokenWarning, setTokenWarning] = useState(false)

  useEffect(() => {
    getGoogleToken().then(token => {
      setGoogleToken(token)
      if (!token) setTokenWarning(true)
    })
  }, [])

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

    const enriched = (data || [])
      .filter(a => {
        const shift = (a as any).shifts as Shift
        if (!shift) return false
        return shift.shift_date >= start && shift.shift_date <= end
      })
      .sort((a, b) => {
        const da = (a as any).shifts.shift_date
        const db = (b as any).shifts.shift_date
        return da.localeCompare(db)
      })
      .map(a => ({ ...a, shift: (a as any).shifts as Shift }))

    setAssignments(enriched)
    setLoading(false)
  }

  async function syncShift(assignment: AssignmentWithShift) {
    if (!googleToken) {
      setTokenWarning(true)
      return
    }

    setSyncing(prev => ({ ...prev, [assignment.shift_id]: true }))

    if (assignment.google_calendar_event_id) {
      // Verwijder bestaand event
      await deleteCalendarEvent(assignment.google_calendar_event_id, googleToken)
      await supabase.from('assignments')
        .update({ google_calendar_event_id: null })
        .eq('id', assignment.id)
      await loadAssignments()
    } else {
      // Maak nieuw event aan
      const eventId = await createCalendarEvent(assignment.shift, googleToken)
      if (eventId) {
        await supabase.from('assignments')
          .update({ google_calendar_event_id: eventId })
          .eq('id', assignment.id)
        await loadAssignments()
      } else {
        alert('Kon agenda-item niet aanmaken. Je Google token is mogelijk verlopen — log opnieuw in.')
        setGoogleToken(null)
        setTokenWarning(true)
      }
    }

    setSyncing(prev => ({ ...prev, [assignment.shift_id]: false }))
  }

  async function syncAll() {
    if (!googleToken) { setTokenWarning(true); return }
    const unsynced = assignments.filter(a => !a.google_calendar_event_id)
    for (const a of unsynced) {
      await syncShift(a)
    }
  }

  const totalHours = assignments.reduce((sum, a) => sum + Number(a.shift.duration_hours), 0)
  const syncedCount = assignments.filter(a => a.google_calendar_event_id).length
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
    type === 'ochtend' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'

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

      {/* Google Calendar token waarschuwing */}
      {tokenWarning && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800 flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="font-medium">Google Agenda-koppeling niet beschikbaar</p>
            <p className="mt-1">Log uit en opnieuw in om je diensten te synchroniseren met Google Agenda. Je account heeft de agenda-rechten nog niet.</p>
          </div>
        </div>
      )}

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
        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
          <p className="text-2xl font-bold text-indigo-700">{syncedCount}/{assignments.length}</p>
          <p className="text-xs text-indigo-600 mt-1">In Google Agenda</p>
        </div>
      </div>

      {/* Sync knop */}
      {assignments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Google Agenda synchroniseren</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {syncedCount === assignments.length
                ? '✓ Alle diensten staan in je agenda'
                : `${assignments.length - syncedCount} dienst${assignments.length - syncedCount !== 1 ? 'en' : ''} nog niet gesynchroniseerd`}
            </p>
          </div>
          <button
            onClick={syncAll}
            disabled={!googleToken || syncedCount === assignments.length}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Alles synchroniseren
          </button>
        </div>
      )}

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
            {assignments.map(a => (
              <div key={a.shift.id} className="px-4 py-4 flex items-center justify-between gap-3">
                <div className="flex-1">
                  <p className="font-medium text-gray-900 capitalize">{formatDate(a.shift.shift_date)}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {a.shift.start_time.slice(0, 5)} – {a.shift.end_time.slice(0, 5)}
                    <span className="mx-1">·</span>
                    {a.shift.duration_hours}u
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${shiftBadge(a.shift.shift_type)}`}>
                    {a.shift.shift_type}
                  </span>
                  <button
                    onClick={() => syncShift(a)}
                    disabled={syncing[a.shift_id] || !googleToken}
                    title={a.google_calendar_event_id ? 'Verwijder uit Google Agenda' : 'Voeg toe aan Google Agenda'}
                    className={`p-1.5 rounded-lg transition-colors ${
                      a.google_calendar_event_id
                        ? 'text-green-600 bg-green-50 hover:bg-green-100'
                        : 'text-gray-400 bg-gray-50 hover:bg-gray-100'
                    } disabled:opacity-40`}
                  >
                    {syncing[a.shift_id] ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
