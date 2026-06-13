import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { getGoogleToken } from '../lib/auth'
import { createCalendarEvent, deleteCalendarEvent, repairMonthEvents, eventIdFor } from '../lib/calendar'
import { Shift, Assignment, SwappableAssignment } from '../types'
import { formatDate, monthLabel } from '../utils/dates'
import { effectiveShift } from '../utils/shiftTimes'

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
  const [repairing, setRepairing] = useState(false)
  const [autoCleaned, setAutoCleaned] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [googleToken, setGoogleToken] = useState<string | null>(null)
  const [tokenWarning, setTokenWarning] = useState(false)
  const [incomingSwapCount, setIncomingSwapCount] = useState(0)
  const [swapModal, setSwapModal] = useState<AssignmentWithShift | null>(null)
  const [swappable, setSwappable] = useState<SwappableAssignment[]>([])
  // Wie werkt er nog meer op mijn diensten (voornaam per shift_id).
  const [colleagues, setColleagues] = useState<Record<string, string[]>>({})
  const [loadingSwappable, setLoadingSwappable] = useState(false)
  const [swapSuccess, setSwapSuccess] = useState(false)

  useEffect(() => {
    getGoogleToken().then(token => {
      setGoogleToken(token)
      if (!token) setTokenWarning(true)
    })
  }, [])

  useEffect(() => {
    if (profile) loadIncomingSwapCount()
  }, [profile])

  useEffect(() => {
    if (!profile) return
    setAutoSynced(false)
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

  // Eenmalige, stille opschoning per gebruiker: verwijdert oude dubbele
  // agenda-afspraken (van vóór de fix) en houdt er één per dienst over.
  // Draait automatisch op de achtergrond zodra iemand Mijn rooster opent.
  useEffect(() => {
    if (!profile || !googleToken || autoCleaned) return
    const key = `cal-cleaned-v1-${profile.id}`
    if (localStorage.getItem(key)) { setAutoCleaned(true); return }
    setAutoCleaned(true)
    runAutoCleanup(googleToken)
      .then(() => localStorage.setItem(key, '1'))
      .catch(() => {})
  }, [profile, googleToken, autoCleaned])

  async function runAutoCleanup(token: string) {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    // Alle goedgekeurde diensten van deze gebruiker vanaf de huidige maand.
    const { data } = await supabase
      .from('assignments')
      .select('*, shifts(*)')
      .eq('user_id', profile!.id)
      .eq('status', 'approved')

    const items = (data || [])
      .filter(a => (a as any).shifts)
      .map(a => ({ id: a.id, shift: effectiveShift((a as any).shifts as Shift, a) }))
      .filter(it => it.shift.shift_date >= monthStart)
    if (items.length === 0) return

    // Per maand groeperen en opschonen.
    const byMonth = new Map<string, { id: string; shift: Shift }[]>()
    for (const it of items) {
      const key = it.shift.shift_date.slice(0, 7)
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key)!.push(it)
    }
    for (const [key, group] of byMonth) {
      const [y, m] = key.split('-').map(Number)
      await repairMonthEvents(token, group, y, m)
      for (const a of group) await persistEventId(a.id, eventIdFor(a.id))
    }
    await loadAssignments()
  }

  async function runAutoSync(unsynced: AssignmentWithShift[], token: string) {
    setAutoSyncing(true)
    let synced = 0
    for (const a of unsynced) {
      const eventId = await createCalendarEvent(a.shift, token, a.id)
      if (eventId) {
        await persistEventId(a.id, eventId)
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
      // Afwijkende werktijden (door de admin ingesteld) gaan vóór de
      // standaardtijden — ook in de agenda-sync en urentelling.
      .map(a => ({ ...a, shift: effectiveShift((a as any).shifts as Shift, a) }))

    setAssignments(enriched)
    setLoading(false)
    loadColleagues(enriched.map(a => a.shift_id))
  }

  // Haal op wie er nog meer op mijn diensten staan, zodat je ziet met
  // wie je werkt (en dus met wie je zou kunnen ruilen).
  async function loadColleagues(shiftIds: string[]) {
    if (shiftIds.length === 0) { setColleagues({}); return }
    const { data } = await supabase
      .from('shifts_with_assignments')
      .select('id, assigned_students')
      .in('id', shiftIds)
    const map: Record<string, string[]> = {}
    for (const row of data || []) {
      map[(row as any).id] = ((row as any).assigned_students || [])
        .filter((s: any) => s.status === 'approved' && s.user_id !== profile!.id)
        .map((s: any) => (s.full_name || s.email).split(' ')[0])
    }
    setColleagues(map)
  }

  // Slaat het agenda-id op via een RPC (studenten mogen de tabel niet direct
  // wijzigen). Best-effort: faalt het, dan voorkomt het vaste agenda-id alsnog
  // duplicaten.
  async function persistEventId(assignmentId: string, eventId: string | null) {
    await supabase.rpc('set_calendar_event_id', { p_assignment_id: assignmentId, p_event_id: eventId })
  }

  async function syncShift(assignment: AssignmentWithShift) {
    if (!googleToken) { setTokenWarning(true); return }
    setSyncing(prev => ({ ...prev, [assignment.shift_id]: true }))

    if (assignment.google_calendar_event_id) {
      await deleteCalendarEvent(assignment.google_calendar_event_id, googleToken)
      await persistEventId(assignment.id, null)
      await loadAssignments()
    } else {
      const eventId = await createCalendarEvent(assignment.shift, googleToken, assignment.id)
      if (eventId) {
        await persistEventId(assignment.id, eventId)
        await loadAssignments()
      } else {
        alert('Kon agenda-item niet aanmaken. Je Google token is mogelijk verlopen — log opnieuw in.')
        setGoogleToken(null)
        setTokenWarning(true)
      }
    }

    setSyncing(prev => ({ ...prev, [assignment.shift_id]: false }))
  }

  async function loadIncomingSwapCount() {
    const { count } = await supabase
      .from('shift_swaps')
      .select('*', { count: 'exact', head: true })
      .eq('target_user_id', profile!.id)
      .eq('status', 'pending')
    setIncomingSwapCount(count || 0)
  }

  async function openSwapModal(assignment: AssignmentWithShift) {
    setSwapModal(assignment)
    setLoadingSwappable(true)
    const { data } = await supabase.rpc('get_swappable_assignments')
    const sorted = ((data as SwappableAssignment[]) || [])
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time))
    setSwappable(sorted)
    setLoadingSwappable(false)
  }

  async function requestSwap(targetAssignmentId: string, targetUserId: string) {
    if (!profile || !swapModal) return
    const { error } = await supabase.from('shift_swaps').insert({
      requester_id: profile.id,
      requester_assignment_id: swapModal.id,
      target_user_id: targetUserId,
      target_assignment_id: targetAssignmentId,
    })
    if (error) { alert('Ruilverzoek mislukt: ' + error.message); return }
    setSwapModal(null)
    setSwapSuccess(true)
    setTimeout(() => setSwapSuccess(false), 5000)
  }

  async function syncAll() {
    if (!googleToken) { setTokenWarning(true); return }
    const unsynced = assignments.filter(a => !a.google_calendar_event_id)
    for (const a of unsynced) await syncShift(a)
  }

  // Ruimt dubbele agenda-afspraken op en zet elke dienst nog één keer neer.
  async function repairSync() {
    if (!googleToken) { setTokenWarning(true); return }
    setRepairing(true)
    const [y, m] = selectedMonth.split('-').map(Number)
    const approved = assignments.filter(a => a.status === 'approved').map(a => ({ id: a.id, shift: a.shift }))
    const removed = await repairMonthEvents(googleToken, approved, y, m)
    for (const a of approved) await persistEventId(a.id, eventIdFor(a.id))
    await loadAssignments()
    setRepairing(false)
    alert(removed > 0
      ? `${removed} dubbele afspraak/afspraken opgeruimd. Elke dienst staat nu nog één keer in je agenda.`
      : 'Geen duplicaten gevonden — alles staat netjes één keer in je agenda.')
  }

  const approvedAssignments = assignments.filter(a => a.status === 'approved')
  const pendingAssignments = assignments.filter(a => a.status === 'pending')
  const reserveAssignments = assignments.filter(a => a.status === 'reserve')
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

      {/* Inkomende ruilverzoeken */}
      {incomingSwapCount > 0 && (
        <Link to="/ruilverzoeken" className="card p-4 flex items-center justify-between gap-3 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-dark">
                {incomingSwapCount} ruilverzoek{incomingSwapCount !== 1 ? 'en' : ''}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Een collega wil met je ruilen</p>
            </div>
          </div>
          <span className="text-sm font-semibold flex-shrink-0" style={{ color: '#f87369' }}>Bekijken →</span>
        </Link>
      )}

      {/* Swap success */}
      {swapSuccess && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-dark">Ruilverzoek verstuurd</p>
        </div>
      )}

      {/* Auto-sync bezig */}
      {autoSyncing && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <div className="w-4 h-4 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
          </div>
          <div>
            <p className="text-sm font-semibold text-dark">Synchroniseren met Google Agenda</p>
            <p className="text-xs text-gray-400 mt-0.5">Diensten worden automatisch toegevoegd...</p>
          </div>
        </div>
      )}

      {/* Auto-sync gelukt */}
      {autoSyncSuccess && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-dark">Diensten toegevoegd aan je Google Agenda</p>
        </div>
      )}

      {/* Google Calendar warning */}
      {tokenWarning && (
        <div className="card p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-dark">Google Agenda niet verbonden</p>
            <p className="text-xs text-gray-400 mt-0.5">Log uit en opnieuw in om diensten te synchroniseren.</p>
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
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Wacht op goedkeuring</p>
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

      {/* Reservelijst */}
      {reserveAssignments.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-sky-50/60">
            <p className="text-xs font-semibold text-sky-600 uppercase tracking-widest">Op de reservelijst</p>
          </div>
          <div className="divide-y divide-gray-50">
            {reserveAssignments.map(a => (
              <div key={a.shift.id} className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-sky-100 text-sky-700 text-xs font-bold">
                    {new Date(a.shift.shift_date).getDate()}
                  </div>
                  <div>
                    <p className="font-semibold text-dark capitalize text-sm">{formatDate(a.shift.shift_date)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {a.shift.start_time.slice(0, 5)} – {a.shift.end_time.slice(0, 5)} · {a.shift.duration_hours}u
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-100 text-sky-700">
                  Reserve
                </span>
              </div>
            ))}
          </div>
          <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-50">
            Je staat achter de hand voor deze dienst{reserveAssignments.length !== 1 ? 'en' : ''}. Komt er een plek vrij, dan benaderen we je.
          </p>
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
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={repairSync}
              disabled={!googleToken || repairing || autoSyncing}
              title="Verwijder dubbele afspraken en zet elke dienst één keer in je agenda"
              className="text-sm font-medium px-3 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors disabled:opacity-50"
            >
              {repairing ? 'Opruimen...' : 'Dubbele opruimen'}
            </button>
            <button
              onClick={syncAll}
              disabled={!googleToken || syncedCount === approvedAssignments.length || autoSyncing || repairing}
              className="flex items-center gap-2 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#3c3c3b' }}
            >
              <CalendarSyncIcon className="w-4 h-4" />
              Alles synchroniseren
            </button>
          </div>
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
                    {(colleagues[a.shift_id] || []).length > 0 && (
                      <p className="text-xs text-indigo-400 font-medium mt-0.5">
                        Samen met {(colleagues[a.shift_id] || []).join(' en ')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${
                    a.shift.shift_type === 'ochtend'
                      ? 'bg-orange-50 text-orange-500'
                      : 'bg-indigo-50 text-indigo-500'
                  }`}>
                    {a.shift.shift_type}
                  </span>
                  <button
                    onClick={() => openSwapModal(a)}
                    title="Ruilverzoek aanvragen bij een collega"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-indigo-500 bg-indigo-50 hover:bg-indigo-100 transition-colors text-xs font-semibold"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
                    </svg>
                    Ruilen
                  </button>
                  <button
                    onClick={() => syncShift(a)}
                    disabled={syncing[a.shift_id] || !googleToken}
                    title={a.google_calendar_event_id ? 'Verwijder uit Google Agenda' : 'Voeg toe aan Google Agenda'}
                    className={`p-2 rounded-xl transition-colors disabled:opacity-40 ${
                      a.google_calendar_event_id
                        ? 'text-emerald-500 bg-emerald-50 hover:bg-emerald-100'
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
      {/* Swap modal */}
      {swapModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSwapModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col z-10">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="font-bold text-dark">Ruilverzoek</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Jouw dienst: {new Date(swapModal.shift.shift_date + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })} · {swapModal.shift.shift_type}
                </p>
              </div>
              <button onClick={() => setSwapModal(null)} className="text-gray-400 hover:text-dark text-2xl leading-none transition-colors">×</button>
            </div>
            <div className="p-4 overflow-y-auto">
              {loadingSwappable ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#f87369', borderTopColor: 'transparent' }} />
                </div>
              ) : swappable.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">
                  Geen collega's met ruilbare diensten beschikbaar.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                    Kies de dienst van een collega om mee te ruilen
                  </p>
                  {swappable.map(a => (
                    <button
                      key={a.assignment_id}
                      onClick={() => requestSwap(a.assignment_id, a.user_id)}
                      className="w-full text-left p-3.5 rounded-xl border border-gray-100 hover:border-salmon-300 hover:bg-orange-50/30 transition-colors"
                    >
                      <p className="text-sm font-semibold text-dark">{a.full_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(a.shift_date + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
                        {' · '}{a.shift_type}{' · '}{a.start_time.slice(0, 5)} – {a.end_time.slice(0, 5)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Hoe werkt ruilen */}
            <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50/60 flex-shrink-0 rounded-b-2xl">
              <p className="text-[11px] text-gray-400 leading-relaxed">
                <span className="font-semibold text-gray-500">Zo werkt ruilen:</span>{' '}
                1. jij kiest hierboven een dienst van een collega · 2. je collega keurt het verzoek goed
                · 3. de admin bevestigt de ruil. Daarna worden jullie roosters omgewisseld.
                Controleer na een ruil even je Google Agenda.
              </p>
            </div>
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
