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
  const [autoSyncing, setAutoSyncing] = useState(false)
  const [autoSyncSuccess, setAutoSyncSuccess] = useState(false)
  const [autoSynced, setAutoSynced] = useState(false)
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

  // Auto-sync newly approved shifts when both token and assignments are ready
  useEffect(() => {
    if (loading || autoSynced || !googleToken) return
    const unsynced = assignments.filter(a => a.status === 'approved' && !a.google_calendar_event_id)
    if (unsynced.length === 0) return
    setAutoSynced(true)
    runAutoSync(unsynced, googleToken)
  }, [loading, googleToken, assignments, autoSynced])

  async function runAutoSync(unsynced: AssignmentWithShift[], token: string) {
    setAutoSyncing(true)
    let synced = 0
    for (const a of unsynced) {
      const eventId = await createCalendarEvent(a.shift, token)
      if (eventId) {
        await supabase.from('assignments').update({ google_calendar_event_id: eventId }).eq('id', a.id)
        synced++
      }
    }
    if (synced > 0) {
      await loadAssignments()
      setAutoSyncSuccess(true)
      setTimeout(() => setAutoSyncSuccess(false), 5000)
    }
    setAutoSyncing(false)
  }

  async function loadAssignments() {
    setLoading(true)
    setAutoSynced(false)
    const [year, month] = selectedMonth.split('-').map(Number)
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const end   = `${year}-${String(month).padStart(2, '0')}-31`

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
        if (a.status !== b.status) return a.status === 'approved' ? -1 : 1
        return (a as any).shifts.shift_date.localeCompare((b as any).shifts.shift_date)
      })
      .map(a => ({ ...a, shift: (a as any).shifts as Shift }))

    setAssignments(enriched)
    setLoading(false)
  }

  async function syncShift(assignment: AssignmentWithShift) {
    if (!googleToken) { setTokenWarning(true); return }
    setSyncing(prev => ({ ...prev, [assignment.shift_id]: true }))

    if (assignment.google_calendar_event_id) {
      await deleteCalendarEvent(assignment.google_calendar_event_id, googleToken)
      await supabase.from('assignments').update({ google_calendar_event_id: null }).eq('id', assignment.id)
      await loadAssignments()
    } else {
      const eventId = await createCalendarEvent(assignment.shift, googleToken)
      if (eventId) {
        await supabase.from('assignments').update({ google_calendar_event_id: eventId }).eq('id', assignment.id)
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
    for (const a of unsynced) await syncShift(a)
  }

  const approvedAssignments = assignments.filter(a => a.status === 'approved')
  const pendingAssignments = assignments.filter(a => a.status === 'pending')
  const totalHours = approvedAssignments.reduce((sum, a) => sum + Number(a.shift.duration_hours), 0)
  const syncedCount = approvedAssignments.filter(a => a.google_calendar_event_id).length
  const [year, month] = selectedMonth.split('-').map(Number)

  function generateMonthOptions() {
    const now = new Date()
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i - 1, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { value, label: monthLabel(d.getFullYear(), d.getMonth() + 1) }
    })
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">Mijn rooster</h1>
          <p className="text-gray-400 text-sm mt-0.5">Jouw ingeplande diensten</p>
        </div>
        <select
          className="border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-medium text-dark focus:outline-none focus:border-salmon-400"
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
        >
          {generateMonthOptions().map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Auto-sync bezig */}
      {autoSyncing && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="font-medium">Diensten worden gesynchroniseerd met Google Agenda...</p>
        </div>
      )}

      {/* Auto-sync gelukt */}
      {autoSyncSuccess && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
          <span className="text-lg flex-shrink-0">✓</span>
          <p className="font-medium">Diensten zijn automatisch aan je Google Agenda toegevoegd.</p>
        </div>
      )}

      {/* Google Calendar warning */}
      {tokenWarning && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <span className="text-lg flex-shrink-0">⚠️</span>
          <div>
            <p className="font-semibold">Google Agenda-koppeling niet beschikbaar</p>
            <p className="mt-0.5 text-amber-700">Log uit en opnieuw in om diensten te synchroniseren met Google Agenda.</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-2xl font-bold" style={{ color: '#f87369' }}>{approvedAssignments.length}</p>
          <p className="text-xs text-gray-400 mt-1">Ingeroosterd</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-dark">{totalHours}u</p>
          <p className="text-xs text-gray-400 mt-1">Totaal uren</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-amber-600">{pendingAssignments.length}</p>
          <p className="text-xs text-gray-400 mt-1">Wacht op goedkeuring</p>
        </div>
      </div>

      {/* Pending aanvragen */}
      {pendingAssignments.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50 bg-amber-50">
            <p className="text-xs font-bold text-amber-700 uppercase tracking-widest">Wacht op goedkeuring</p>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingAssignments.map(a => (
              <div key={a.shift.id} className="px-5 py-4 flex items-center justify-between gap-3 opacity-70">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100 text-amber-700 text-xs font-bold">
                    {new Date(a.shift.shift_date).getDate()}
                  </div>
                  <div>
                    <p className="font-semibold text-dark capitalize text-sm">{formatDate(a.shift.shift_date)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {a.shift.start_time.slice(0, 5)} – {a.shift.end_time.slice(0, 5)} · {a.shift.duration_hours}u
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                  ⏳ Aangevraagd
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync bar */}
      {approvedAssignments.length > 0 && (
        <div className="card p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-dark">Google Agenda synchroniseren</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {syncedCount === approvedAssignments.length
                ? '✓ Alle diensten staan in je agenda'
                : `${approvedAssignments.length - syncedCount} dienst${approvedAssignments.length - syncedCount !== 1 ? 'en' : ''} nog niet gesynchroniseerd`}
            </p>
          </div>
          <button
            onClick={syncAll}
            disabled={!googleToken || syncedCount === approvedAssignments.length || autoSyncing}
            className="flex items-center gap-2 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            style={{ backgroundColor: '#3c3c3b' }}
          >
            <CalendarSyncIcon className="w-4 h-4" />
            Alles synchroniseren
          </button>
        </div>
      )}

      {/* Shifts list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#f87369', borderTopColor: 'transparent' }} />
        </div>
      ) : approvedAssignments.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-gray-500 font-semibold">Geen goedgekeurde diensten in {monthLabel(year, month)}</p>
          <p className="text-gray-400 text-sm mt-1">
            {pendingAssignments.length > 0 ? 'Je hebt diensten aangevraagd die nog goedgekeurd worden.' : 'Je bent nog niet ingeroosterd voor deze maand.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-gray-50">
            {approvedAssignments.map(a => (
              <div key={a.shift.id} className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                    style={{ backgroundColor: a.shift.shift_type === 'ochtend' ? '#f87369' : '#3c3c3b' }}
                  >
                    {new Date(a.shift.shift_date).getDate()}
                  </div>
                  <div>
                    <p className="font-semibold text-dark capitalize text-sm">{formatDate(a.shift.shift_date)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {a.shift.start_time.slice(0, 5)} – {a.shift.end_time.slice(0, 5)} · {a.shift.duration_hours}u
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
                    a.shift.shift_type === 'ochtend'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-purple-100 text-purple-700'
                  }`}>
                    {a.shift.shift_type}
                  </span>
                  <button
                    onClick={() => syncShift(a)}
                    disabled={syncing[a.shift_id] || !googleToken}
                    title={a.google_calendar_event_id ? 'Verwijder uit Google Agenda' : 'Voeg toe aan Google Agenda'}
                    className={`p-2 rounded-xl transition-colors disabled:opacity-40 ${
                      a.google_calendar_event_id
                        ? 'text-green-600 bg-green-50 hover:bg-green-100'
                        : 'text-gray-400 bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    {syncing[a.shift_id] ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CalendarSyncIcon className="w-4 h-4" />
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

function CalendarSyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}
