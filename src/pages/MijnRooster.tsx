import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useSettings, shiftTypeConfig } from '../hooks/useSettings'
import { supabase } from '../lib/supabase'
import { getGoogleToken, signInWithGoogle } from '../lib/auth'
import { createCalendarEvent, deleteCalendarEvent, repairMonthEvents, eventIdFor } from '../lib/calendar'
import { Shift, Assignment, AssignmentWithShiftJoin, SwappableAssignment, ShiftWithAssignments } from '../types'
import { formatDate, monthLabel, isoWeek, dateToISO } from '../utils/dates'
import { effectiveShift } from '../utils/shiftTimes'

interface AssignmentWithShift extends Assignment {
  shift: Shift
}

// Afmelden van de reservelijst kan tot 24 uur voor de start van de dienst
// (dezelfde grens wordt server-side afgedwongen via RLS).
function canLeaveReserve(shift: Shift): boolean {
  return new Date(`${shift.shift_date}T${shift.start_time}`).getTime() - Date.now() > 24 * 60 * 60 * 1000
}

// Accentkleur per dagdeel (tijdbalkje links op de kaart).
const TYPE_COLORS: Record<string, string> = {
  ochtend: '#fb923c',
  middag: '#818cf8',
}

export default function MijnRooster() {
  const { profile } = useAuth()
  const { settings } = useSettings()
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
  const [incomingSwapCount, setIncomingSwapCount] = useState(0)
  const [swapModal, setSwapModal] = useState<AssignmentWithShift | null>(null)
  const [swappable, setSwappable] = useState<SwappableAssignment[]>([])
  // Wie werkt er nog meer op mijn diensten (voornaam per shift_id).
  const [colleagues, setColleagues] = useState<Record<string, string[]>>({})
  const [loadingSwappable, setLoadingSwappable] = useState(false)
  const [swapSuccess, setSwapSuccess] = useState(false)
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    getGoogleToken().then(token => setGoogleToken(token))
  }, [])

  useEffect(() => {
    if (profile) loadIncomingSwapCount()
  }, [profile])

  useEffect(() => {
    if (!profile) return
    setAutoSynced(false)
    setShowPast(false)
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

    const { data } = await supabase
      .from('assignments')
      .select('*, shifts(*)')
      .eq('user_id', profile!.id)
      .eq('status', 'approved')

    const items = ((data || []) as AssignmentWithShiftJoin[])
      .filter(a => a.shifts)
      .map(a => ({ id: a.id, shift: effectiveShift(a.shifts!, a) }))
      .filter(it => it.shift.shift_date >= monthStart)
    if (items.length === 0) return

    const byMonth = new Map<string, { id: string; shift: Shift }[]>()
    for (const it of items) {
      const key = it.shift.shift_date.slice(0, 7)
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key)!.push(it)
    }
    for (const [key, group] of byMonth) {
      const [y, m] = key.split('-').map(Number)
      await repairMonthEvents(token, group, y, m, settings.calendar_label)
      for (const a of group) await persistEventId(a.id, eventIdFor(a.id))
    }
    await loadAssignments()
  }

  async function runAutoSync(unsynced: AssignmentWithShift[], token: string) {
    setAutoSyncing(true)
    let synced = 0
    for (const a of unsynced) {
      const eventId = await createCalendarEvent(a.shift, token, a.id, settings.calendar_label)
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

    const enriched = ((data || []) as AssignmentWithShiftJoin[])
      .filter(a => {
        const shift = a.shifts
        if (!shift) return false
        return shift.shift_date >= start && shift.shift_date <= end
      })
      .sort((a, b) => a.shifts!.shift_date.localeCompare(b.shifts!.shift_date)
        || a.shifts!.start_time.localeCompare(b.shifts!.start_time))
      // Afwijkende werktijden (door de admin ingesteld) gaan vóór de
      // standaardtijden — ook in de agenda-sync en urentelling.
      .map(a => ({ ...a, shift: effectiveShift(a.shifts!, a) }))

    setAssignments(enriched)
    setLoading(false)
    loadColleagues(enriched.map(a => a.shift_id))
  }

  async function loadColleagues(shiftIds: string[]) {
    if (shiftIds.length === 0) { setColleagues({}); return }
    const { data } = await supabase
      .from('shifts_with_assignments')
      .select('id, assigned_students')
      .in('id', shiftIds)
    const map: Record<string, string[]> = {}
    for (const row of (data || []) as Pick<ShiftWithAssignments, 'id' | 'assigned_students'>[]) {
      map[row.id] = (row.assigned_students || [])
        .filter(s => s.status === 'approved' && s.user_id !== profile!.id)
        .map(s => (s.full_name || s.email).split(' ')[0])
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
    if (!googleToken) return
    setSyncing(prev => ({ ...prev, [assignment.shift_id]: true }))

    if (assignment.google_calendar_event_id) {
      await deleteCalendarEvent(assignment.google_calendar_event_id, googleToken)
      await persistEventId(assignment.id, null)
      await loadAssignments()
    } else {
      const eventId = await createCalendarEvent(assignment.shift, googleToken, assignment.id, settings.calendar_label)
      if (eventId) {
        await persistEventId(assignment.id, eventId)
        await loadAssignments()
      } else {
        // Token verlopen: opnieuw koppelen lost het op.
        setGoogleToken(null)
      }
    }

    setSyncing(prev => ({ ...prev, [assignment.shift_id]: false }))
  }

  async function withdrawPending(a: AssignmentWithShift) {
    if (!confirm(`Je aanmelding voor ${formatDate(a.shift.shift_date)} intrekken?`)) return
    await supabase.from('assignments').delete().eq('id', a.id)
    await loadAssignments()
  }

  async function leaveReserve(a: AssignmentWithShift) {
    if (!confirm(`Wil je jezelf van de reservelijst voor ${formatDate(a.shift.shift_date)} afmelden?`)) return
    const { error } = await supabase.from('assignments').delete().eq('id', a.id)
    if (error) { alert('Afmelden mislukt: ' + error.message); return }
    await loadAssignments()
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
    if (!googleToken) return
    const unsynced = assignments.filter(a => a.status === 'approved' && !a.google_calendar_event_id)
    for (const a of unsynced) await syncShift(a)
  }

  // Ruimt dubbele agenda-afspraken op en zet elke dienst nog één keer neer.
  async function repairSync() {
    if (!googleToken) return
    setRepairing(true)
    const [y, m] = selectedMonth.split('-').map(Number)
    const approved = assignments.filter(a => a.status === 'approved').map(a => ({ id: a.id, shift: a.shift }))
    const removed = await repairMonthEvents(googleToken, approved, y, m, settings.calendar_label)
    for (const a of approved) await persistEventId(a.id, eventIdFor(a.id))
    await loadAssignments()
    setRepairing(false)
    alert(removed > 0
      ? `${removed} dubbele afspraak/afspraken opgeruimd. Elke dienst staat nu nog één keer in je agenda.`
      : 'Geen duplicaten gevonden — alles staat netjes één keer in je agenda.')
  }

  function shiftMonth(delta: number) {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const nowMonth = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })()

  const approvedAssignments = assignments.filter(a => a.status === 'approved')
  const pendingCount = assignments.filter(a => a.status === 'pending').length
  const reserveCount = assignments.filter(a => a.status === 'reserve').length
  const totalHours = approvedAssignments.reduce((sum, a) => sum + Number(a.shift.duration_hours), 0)
  const unsyncedCount = approvedAssignments.filter(a => !a.google_calendar_event_id).length
  const [year, month] = selectedMonth.split('-').map(Number)
  const monthMax = profile ? Math.round(Number(profile.contract_max_hours) * settings.monthly_cap_factor * 10) / 10 : 0
  const nlNum = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

  const todayISO = dateToISO(new Date())

  // Agenda: alle toewijzingen per dag, gegroepeerd per week.
  const weeks = useMemo(() => {
    const dayMap = new Map<string, AssignmentWithShift[]>()
    for (const a of assignments) {
      const d = a.shift.shift_date
      if (!dayMap.has(d)) dayMap.set(d, [])
      dayMap.get(d)!.push(a)
    }
    const days = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const weekMap = new Map<number, { week: number; days: typeof days; count: number; hours: number }>()
    for (const [iso, dayAssignments] of days) {
      const w = isoWeek(iso)
      if (!weekMap.has(w)) weekMap.set(w, { week: w, days: [], count: 0, hours: 0 })
      const entry = weekMap.get(w)!
      entry.days.push([iso, dayAssignments])
      entry.count += dayAssignments.length
      entry.hours += dayAssignments
        .filter(a => a.status === 'approved')
        .reduce((n, a) => n + Number(a.shift.duration_hours), 0)
    }
    return [...weekMap.values()].sort((a, b) => a.days[0][0].localeCompare(b.days[0][0]))
  }, [assignments])

  // In de huidige maand: begin bij vandaag en klap het verleden in.
  const isCurrentMonth = selectedMonth === nowMonth
  const pastShiftCount = isCurrentMonth
    ? assignments.filter(a => a.shift.shift_date < todayISO).length
    : 0
  const visibleWeeks = useMemo(() => {
    if (!isCurrentMonth || showPast) return weeks
    return weeks
      .map(w => ({ ...w, days: w.days.filter(([iso]) => iso >= todayISO) }))
      .filter(w => w.days.length > 0)
  }, [weeks, isCurrentMonth, showPast, todayISO])

  return (
    <div className="space-y-5">
      {/* Header + maandnavigatie */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-dark">Mijn rooster</h1>
          <p className="text-gray-400 text-sm mt-0.5">Jouw persoonlijke werkagenda</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => shiftMonth(-1)} aria-label="Vorige maand"
            className="w-9 h-9 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-dark hover:border-gray-300 transition-colors">‹</button>
          <p className="font-semibold text-dark text-sm px-2.5 capitalize whitespace-nowrap">{monthLabel(year, month)}</p>
          <button onClick={() => shiftMonth(1)} aria-label="Volgende maand"
            className="w-9 h-9 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-dark hover:border-gray-300 transition-colors">›</button>
          {selectedMonth !== nowMonth && (
            <button onClick={() => setSelectedMonth(nowMonth)}
              className="text-sm font-semibold px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-dark hover:border-gray-300 transition-colors ml-1">
              Vandaag
            </button>
          )}
        </div>
      </div>

      {swapSuccess && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-emerald-600">✓ Ruilverzoek verstuurd — je collega krijgt een melding.</p>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        {/* Zijkolom: samenvatting, koppeling, aanvragen */}
        <div className="space-y-4 order-1 lg:order-2">
          {/* Maandsamenvatting */}
          <div className="card p-5">
            <p className="text-sm font-semibold text-dark capitalize">{monthLabel(year, month)}</p>
            <p className="text-2xl font-bold text-dark mt-2">
              {nlNum(totalHours)}<span className="text-sm font-semibold text-gray-400"> uur ingeroosterd</span>
            </p>
            <p className="text-[13px] text-gray-400 mt-0.5">
              {approvedAssignments.length} dienst{approvedAssignments.length !== 1 ? 'en' : ''}
              {monthMax > 0 && totalHours < monthMax && <> · nog {nlNum(monthMax - totalHours)} uur mogelijk</>}
            </p>
            {monthMax > 0 && (
              <div className="h-1.5 bg-gray-100 rounded-full mt-3 overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, (totalHours / monthMax) * 100)}%`, backgroundColor: 'var(--color-primary)' }} />
              </div>
            )}
          </div>

          {/* Ruilverzoeken die op jou wachten */}
          {incomingSwapCount > 0 && (
            <Link to="/ruilverzoeken" className="card p-4 flex items-center justify-between gap-3 hover:shadow-md transition-shadow">
              <div>
                <p className="text-sm font-semibold text-dark">
                  {incomingSwapCount} ruilverzoek{incomingSwapCount !== 1 ? 'en' : ''}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Een collega wil met je ruilen</p>
              </div>
              <span className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--color-primary)' }}>→</span>
            </Link>
          )}

          {/* Aanvragen-overzicht */}
          {(pendingCount > 0 || reserveCount > 0) && (
            <div className="card p-5">
              <p className="text-sm font-semibold text-dark mb-2.5">Nog niet definitief</p>
              {pendingCount > 0 && (
                <p className="text-[13px] text-gray-500 flex items-center gap-2 py-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  {pendingCount} aanmelding{pendingCount !== 1 ? 'en' : ''} wacht{pendingCount === 1 ? '' : 'en'} op goedkeuring
                </p>
              )}
              {reserveCount > 0 && (
                <p className="text-[13px] text-gray-500 flex items-center gap-2 py-1">
                  <span className="w-2 h-2 rounded-full bg-sky-400 flex-shrink-0" />
                  Reservelijst: {reserveCount} dienst{reserveCount !== 1 ? 'en' : ''}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-2">Ze staan in je agenda met een label; acties staan op de kaart.</p>
            </div>
          )}

          {/* Agenda-koppeling */}
          <div className="card p-5">
            {!googleToken ? (
              <>
                <p className="text-sm font-semibold text-dark">Agenda synchroniseren</p>
                <p className="text-[13px] text-gray-400 mt-1">
                  Voeg je rooster automatisch toe aan je persoonlijke Google Agenda.
                </p>
                <button onClick={() => signInWithGoogle(settings.allowed_domain)}
                  className="mt-3 w-full text-sm font-semibold text-white px-4 py-2 rounded-xl transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  Google Agenda koppelen
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-dark">✓ Google Agenda verbonden</p>
                <p className="text-[13px] text-gray-400 mt-1">
                  {autoSyncing ? 'Diensten worden gesynchroniseerd…'
                    : autoSyncSuccess ? 'Diensten toegevoegd aan je agenda.'
                    : unsyncedCount > 0 ? `${unsyncedCount} dienst${unsyncedCount !== 1 ? 'en' : ''} nog niet in je agenda`
                    : approvedAssignments.length > 0 ? 'Alle diensten staan in je agenda.'
                    : 'Nieuwe diensten verschijnen automatisch.'}
                </p>
                <div className="flex flex-col gap-2 mt-3">
                  {unsyncedCount > 0 && (
                    <button onClick={syncAll} disabled={autoSyncing || repairing}
                      className="text-xs font-semibold text-white px-3.5 py-2 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: 'var(--color-dark)' }}>
                      Synchroniseren
                    </button>
                  )}
                  {approvedAssignments.length > 0 && (
                    <button onClick={repairSync} disabled={repairing || autoSyncing}
                      title="Verwijder dubbele afspraken en zet elke dienst één keer in je agenda"
                      className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors disabled:opacity-50">
                      {repairing ? 'Opruimen…' : 'Dubbele opruimen'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Agenda (hoofdcontent) */}
        <div className="lg:col-span-2 space-y-5 order-2 lg:order-1">
          {loading ? (
            <Spinner />
          ) : assignments.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-gray-500 font-semibold text-sm">Geen diensten in {monthLabel(year, month)}</p>
              <p className="text-gray-400 text-sm mt-1.5">Meld je aan voor diensten via Inschrijven.</p>
              <Link to="/beschikbaarheid" className="inline-block text-sm font-semibold mt-3" style={{ color: 'var(--color-primary)' }}>
                Bekijk beschikbare diensten →
              </Link>
            </div>
          ) : (
            <>
              {pastShiftCount > 0 && !showPast && (
                <button onClick={() => setShowPast(true)}
                  className="w-full py-2.5 rounded-xl border border-dashed border-gray-200 text-[13px] font-medium text-gray-400 hover:text-dark hover:border-gray-300 transition-colors">
                  {pastShiftCount} eerdere dienst{pastShiftCount !== 1 ? 'en' : ''} deze maand tonen
                </button>
              )}

              {visibleWeeks.map(w => (
                <div key={w.week}>
                  {/* Weekkop */}
                  <div className="flex items-baseline justify-between mb-2 px-0.5">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Week {w.week}</p>
                    <p className="text-[13px] text-gray-400">
                      {w.count} dienst{w.count !== 1 ? 'en' : ''}{w.hours > 0 && <> · {nlNum(w.hours)}u</>}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {w.days.map(([iso, dayAssignments]) => {
                      const day = new Date(iso + 'T00:00:00')
                      const isToday = iso === todayISO
                      const isPast = iso < todayISO
                      return (
                        <div key={iso} className={isPast ? 'opacity-60' : ''}>
                          <p className={`text-[13px] font-semibold mb-1.5 capitalize ${isToday ? '' : 'text-gray-500'}`}
                            style={isToday ? { color: 'var(--color-primary)' } : {}}>
                            {day.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
                            {isToday && ' · vandaag'}
                          </p>
                          <div className="space-y-2">
                            {dayAssignments.map(a => (
                              <AssignmentCard key={a.id} a={a}
                                typeLabel={shiftTypeConfig(settings, a.shift.shift_type).label}
                                mates={colleagues[a.shift_id] || []}
                                googleConnected={!!googleToken}
                                syncing={!!syncing[a.shift_id]}
                                onSwap={() => openSwapModal(a)}
                                onSync={() => syncShift(a)}
                                onWithdraw={() => withdrawPending(a)}
                                onLeaveReserve={() => leaveReserve(a)}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

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
                  <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
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
            <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50/60 flex-shrink-0 rounded-b-2xl">
              <p className="text-[11px] text-gray-400 leading-relaxed">
                <span className="font-semibold text-gray-500">Zo werkt ruilen:</span>{' '}
                1. jij kiest hierboven een dienst van een collega · 2. je collega keurt het verzoek goed
                · 3. de planning bevestigt de ruil. Daarna worden jullie roosters omgewisseld.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// Eén dienst in de agenda: compact, met tijdbalkje en status in tekst.
// ------------------------------------------------------------

function AssignmentCard({ a, typeLabel, mates, googleConnected, syncing, onSwap, onSync, onWithdraw, onLeaveReserve }: {
  a: AssignmentWithShift
  typeLabel: string
  mates: string[]
  googleConnected: boolean
  syncing: boolean
  onSwap: () => void
  onSync: () => void
  onWithdraw: () => void
  onLeaveReserve: () => void
}) {
  const isApproved = a.status === 'approved'
  const isPending = a.status === 'pending'
  const isReserve = a.status === 'reserve'
  const isFuture = new Date(`${a.shift.shift_date}T${a.shift.start_time}`) > new Date()
  const typeColor = TYPE_COLORS[a.shift.shift_type] || 'var(--color-primary)'

  return (
    <div className="bg-white rounded-xl border border-gray-100 flex overflow-hidden">
      {/* Tijdbalkje per dagdeel */}
      <div className="w-1 flex-shrink-0" style={{ backgroundColor: typeColor }} />
      <div className="flex-1 min-w-0 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
            <p className="text-sm font-semibold text-dark">{typeLabel}dienst</p>
            <p className="text-[13px] text-gray-400">
              {a.shift.start_time.slice(0, 5)} – {a.shift.end_time.slice(0, 5)}
              <span className="text-gray-300"> · </span>{String(a.shift.duration_hours).replace('.', ',')}u
            </p>
            {isApproved && <span className="text-[11px] font-bold text-emerald-600">✓ Ingeroosterd</span>}
            {isPending && <span className="text-[11px] font-bold text-amber-600">Wacht op goedkeuring</span>}
            {isReserve && <span className="text-[11px] font-bold text-sky-600">Reservelijst</span>}
          </div>

          {isApproved && googleConnected && (
            <button onClick={onSync} disabled={syncing}
              title={a.google_calendar_event_id ? 'Verwijder uit Google Agenda' : 'Voeg toe aan Google Agenda'}
              className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg flex-shrink-0 transition-colors disabled:opacity-40 ${
                a.google_calendar_event_id ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-400 bg-gray-50 hover:bg-gray-100'
              }`}>
              {syncing ? '…' : a.google_calendar_event_id ? 'In agenda ✓' : '+ Agenda'}
            </button>
          )}
        </div>

        {(isApproved && mates.length > 0) || isFuture ? (
          <div className="flex items-center justify-between gap-3 mt-1.5 flex-wrap">
            <p className="text-xs text-gray-400 min-w-0">
              {isApproved && mates.length > 0 ? <>Met {mates.join(' en ')}</>
                : isReserve ? 'Komt er een plek vrij, dan krijg je een melding en e-mail.'
                : ''}
            </p>
            {isFuture && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {isApproved && (
                  <button onClick={onSwap}
                    className="text-[11px] font-semibold text-gray-400 hover:text-dark transition-colors underline underline-offset-2">
                    Ruilverzoek
                  </button>
                )}
                {isPending && (
                  <button onClick={onWithdraw}
                    className="text-[11px] font-semibold text-gray-400 hover:text-dark transition-colors underline underline-offset-2">
                    Intrekken
                  </button>
                )}
                {isReserve && canLeaveReserve(a.shift) && (
                  <button onClick={onLeaveReserve}
                    className="text-[11px] font-semibold text-gray-400 hover:text-dark transition-colors underline underline-offset-2">
                    Afmelden
                  </button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
    </div>
  )
}
