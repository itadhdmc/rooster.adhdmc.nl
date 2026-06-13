import { useEffect, useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ShiftWithAssignments, Profile, RosterPeriod } from '../../types'
import { formatDate, monthLabel, dateToISO, getWeeksInMonth, getRosterDaysInMonth, isSaturday, isSingleStudentDay } from '../../utils/dates'
import { hoursBetween } from '../../utils/shiftTimes'

const DEFAULT_TEMPLATES: Record<string, { start_time: string; end_time: string; duration_hours: number }> = {
  ochtend: { start_time: '08:30', end_time: '12:30', duration_hours: 4 },
  middag: { start_time: '12:00', end_time: '17:30', duration_hours: 5.5 },
}

// Aanwezigheid + eventuele afwijkende werktijden per toewijzing.
interface AssignmentMeta {
  attendance: string
  custom_start_time: string | null
  custom_end_time: string | null
}

export default function RoosterBeheer() {
  const { periodId } = useParams<{ periodId: string }>()
  const [period, setPeriod] = useState<RosterPeriod | null>(null)
  const [shifts, setShifts] = useState<ShiftWithAssignments[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showPendingPanel, setShowPendingPanel] = useState(false)
  const [meta, setMeta] = useState<Record<string, AssignmentMeta>>({})
  const [timeEdit, setTimeEdit] = useState<{ id: string; start: string; end: string } | null>(null)
  const [shiftEdit, setShiftEdit] = useState<{ id: string; start: string; end: string; max: number } | null>(null)

  useEffect(() => { loadAll() }, [periodId])

  async function loadAll() {
    if (!periodId) return
    const [{ data: p }, { data: s }, { data: st }, { data: att }] = await Promise.all([
      supabase.from('roster_periods').select('*').eq('id', periodId).single(),
      supabase.from('shifts_with_assignments').select('*').eq('period_id', periodId).order('shift_date').order('shift_type'),
      supabase.from('profiles').select('*').eq('role', 'student').eq('active', true),
      supabase.from('assignments').select('*, shifts!inner(period_id)').eq('shifts.period_id', periodId),
    ])
    const metaMap: Record<string, AssignmentMeta> = {}
    for (const a of att || []) {
      metaMap[(a as any).id] = {
        attendance: (a as any).attendance,
        custom_start_time: (a as any).custom_start_time ?? null,
        custom_end_time: (a as any).custom_end_time ?? null,
      }
    }
    setMeta(metaMap)
    setPeriod(p)
    setShifts(s || [])
    setStudents(st || [])
    setLoading(false)
  }

  async function approveAssignment(assignmentId: string) {
    setProcessing(assignmentId)
    const { error } = await supabase
      .from('assignments')
      .update({ status: 'approved' })
      .eq('id', assignmentId)
    if (error) alert('Goedkeuren mislukt: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  async function rejectAssignment(assignmentId: string) {
    setProcessing(assignmentId)
    await supabase.from('assignments').delete().eq('id', assignmentId)
    await loadAll()
    setProcessing(null)
  }

  // Op de reservelijst zetten (telt niet mee voor de bezetting). Promoveren
  // gaat later via approveAssignment — dan gelden de maandlimiet + mail vanzelf.
  async function reserveAssignment(assignmentId: string) {
    setProcessing(assignmentId)
    const { error } = await supabase
      .from('assignments')
      .update({ status: 'reserve' })
      .eq('id', assignmentId)
    if (error) alert('Op reservelijst zetten mislukt: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  async function removeAssignment(assignmentId: string) {
    setProcessing(assignmentId)
    await supabase.from('assignments').delete().eq('id', assignmentId)
    await loadAll()
    setProcessing(null)
  }

  async function approveAll(assignmentIds: string[]) {
    setProcessing('bulk')
    let blocked = 0
    for (const id of assignmentIds) {
      const { error } = await supabase.from('assignments').update({ status: 'approved' }).eq('id', id)
      if (error) blocked++
    }
    await loadAll()
    setProcessing(null)
    if (blocked > 0) {
      alert(`${blocked} aanvraag/aanvragen niet goedgekeurd: de student zou daarmee boven de maandlimiet (max uren) uitkomen.`)
    }
  }

  async function markAttendance(assignmentId: string, value: string) {
    setProcessing(assignmentId)
    const { error } = await supabase.from('assignments').update({ attendance: value }).eq('id', assignmentId)
    if (error) alert('Aanwezigheid bijwerken mislukt: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  // Afwijkende werktijden voor één persoon opslaan. Tijden gelijk aan de
  // standaard van de dienst? Dan resetten we naar NULL (= standaard volgen).
  async function saveTimes(assignmentId: string, shift: ShiftWithAssignments) {
    if (!timeEdit) return
    const { start, end } = timeEdit
    if (!start || !end || end <= start) {
      alert('De eindtijd moet na de starttijd liggen.')
      return
    }
    const isDefault = start === shift.start_time.slice(0, 5) && end === shift.end_time.slice(0, 5)
    setProcessing(assignmentId)
    const { error } = await supabase.from('assignments').update({
      custom_start_time: isDefault ? null : start,
      custom_end_time: isDefault ? null : end,
    }).eq('id', assignmentId)
    if (error) alert('Tijden opslaan mislukt: ' + error.message)
    else setTimeEdit(null)
    await loadAll()
    setProcessing(null)
  }

  async function resetTimes(assignmentId: string) {
    setProcessing(assignmentId)
    const { error } = await supabase.from('assignments').update({
      custom_start_time: null,
      custom_end_time: null,
    }).eq('id', assignmentId)
    if (error) alert('Tijden terugzetten mislukt: ' + error.message)
    setTimeEdit(null)
    await loadAll()
    setProcessing(null)
  }

  // De standaardtijden van een hele dienst (en max studenten) aanpassen.
  // Geldt voor iedereen op die dienst, behalve wie een afwijkende tijd heeft.
  async function saveShiftEdit(shift: ShiftWithAssignments) {
    if (!shiftEdit) return
    const { start, end, max } = shiftEdit
    if (!start || !end || end <= start) { alert('De eindtijd moet na de starttijd liggen.'); return }
    const approvedCount = (shift.assigned_students || []).filter(a => a.status === 'approved').length
    if (max < 1) { alert('Minimaal 1 student per dienst.'); return }
    if (max < approvedCount) {
      alert(`Er zijn al ${approvedCount} studenten goedgekeurd op deze dienst; het maximum kan niet lager dan dat.`)
      return
    }
    setProcessing(shift.id)
    const { error } = await supabase.from('shifts').update({
      start_time: start,
      end_time: end,
      duration_hours: hoursBetween(start, end),
      max_students: max,
    }).eq('id', shift.id)
    if (error) alert('Dienst bijwerken mislukt: ' + error.message)
    else setShiftEdit(null)
    await loadAll()
    setProcessing(null)
  }

  async function deleteShift(shift: ShiftWithAssignments) {
    const n = (shift.assigned_students || []).length
    const label = shift.shift_type === 'ochtend' ? 'ochtenddienst' : 'middagdienst'
    const msg = n > 0
      ? `Let op: op deze ${label} staan ${n} aanmelding(en)/inroostering(en) die mee verwijderd worden. Weet je het zeker?`
      : `Deze ${label} verwijderen?`
    if (!confirm(msg)) return
    setProcessing(shift.id)
    const { error } = await supabase.from('shifts').delete().eq('id', shift.id)
    if (error) alert('Dienst verwijderen mislukt: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  // Tijden/types die al in deze periode voorkomen; anders de standaard.
  function periodTemplates(): Record<string, { start_time: string; end_time: string; duration_hours: number }> {
    const templates: Record<string, { start_time: string; end_time: string; duration_hours: number }> = {}
    for (const s of shifts) {
      if (!templates[s.shift_type]) {
        templates[s.shift_type] = { start_time: s.start_time, end_time: s.end_time, duration_hours: Number(s.duration_hours) }
      }
    }
    return { ...DEFAULT_TEMPLATES, ...templates }
  }

  // Een ontbrekende ochtend-/middagdienst toevoegen aan de geselecteerde dag.
  async function addShiftToDay(shiftType: 'ochtend' | 'middag') {
    if (!period || !selectedDate) return
    const tpl = periodTemplates()[shiftType]
    const day = new Date(selectedDate + 'T00:00:00')
    setProcessing('addshift' + shiftType)
    const { error } = await supabase.from('shifts').insert({
      period_id: period.id,
      shift_date: selectedDate,
      shift_type: shiftType,
      start_time: tpl.start_time,
      end_time: tpl.end_time,
      duration_hours: tpl.duration_hours,
      max_students: isSingleStudentDay(day) ? 1 : 2,
    })
    if (error) alert('Dienst toevoegen mislukt: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  async function directAssign(shiftId: string, userId: string) {
    setProcessing(shiftId + userId)
    const { error } = await supabase.from('assignments').insert({
      shift_id: shiftId,
      user_id: userId,
      status: 'approved',
    })
    if (error) alert('Fout: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  // Een (nog niet aangemelde) medewerker direct op de reservelijst zetten.
  async function directReserve(shiftId: string, userId: string) {
    setProcessing(shiftId + userId)
    const { error } = await supabase.from('assignments').insert({
      shift_id: shiftId,
      user_id: userId,
      status: 'reserve',
    })
    if (error) alert('Op reservelijst zetten mislukt: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  // Voeg ontbrekende zaterdagen toe aan deze (bestaande) periode, max 1 student.
  async function addSaturdays(dates: string[]) {
    if (!period || dates.length === 0) return
    setProcessing('saturdays')

    // Gebruik de tijden/types die al in deze periode voorkomen; anders standaard.
    const types = periodTemplates()

    const newShifts = []
    for (const iso of dates) {
      for (const [shift_type, tpl] of Object.entries(types)) {
        newShifts.push({
          period_id: period.id,
          shift_date: iso,
          shift_type,
          start_time: tpl.start_time,
          end_time: tpl.end_time,
          duration_hours: tpl.duration_hours,
          max_students: 1,
        })
      }
    }

    const { error } = await supabase.from('shifts').insert(newShifts)
    if (error) alert('Zaterdagen toevoegen mislukt: ' + error.message)
    await loadAll()
    setProcessing(null)
  }

  const shiftsByDate = useMemo(() =>
    shifts.reduce<Record<string, Record<string, ShiftWithAssignments>>>((acc, s) => {
      if (!acc[s.shift_date]) acc[s.shift_date] = {}
      acc[s.shift_date][s.shift_type] = s
      return acc
    }, {}),
    [shifts]
  )

  const selectedDayShifts = selectedDate
    ? shifts.filter(s => s.shift_date === selectedDate).sort((a, b) => a.shift_type.localeCompare(b.shift_type))
    : []

  // Diensttypes die op de geselecteerde dag nog ontbreken (toe te voegen).
  const missingDayTypes = (['ochtend', 'middag'] as const)
    .filter(t => !selectedDayShifts.some(s => s.shift_type === t))

  // Students not yet assigned or pending for a given shift
  function unassignedStudents(shift: ShiftWithAssignments): Profile[] {
    const takenIds = new Set((shift.assigned_students || []).map(s => s.user_id))
    return students.filter(s => !takenIds.has(s.id))
  }

  // Total pending requests across all shifts
  const totalPending = shifts.reduce((n, s) =>
    n + (s.assigned_students || []).filter(a => a.status === 'pending').length, 0)

  if (loading) return <Spinner />
  if (!period) return <div className="text-red-500 p-4">Periode niet gevonden.</div>

  const totalShifts = shifts.length
  const filledShifts = shifts.filter(s => s.open_spots <= 0).length
  const openShifts = totalShifts - filledShifts
  const weeks = getWeeksInMonth(period.year, period.month)

  // Zaterdagen in deze maand die nog geen enkele dienst hebben.
  const saturdayDatesWithShifts = new Set(
    shifts.filter(s => new Date(s.shift_date + 'T00:00:00').getDay() === 6).map(s => s.shift_date)
  )
  const missingSaturdays = getRosterDaysInMonth(period.year, period.month)
    .filter(isSaturday)
    .map(dateToISO)
    .filter(iso => !saturdayDatesWithShifts.has(iso))

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/admin" className="text-gray-400 hover:text-dark transition-colors">← Terug</Link>
        <span className="text-gray-200">/</span>
        <h1 className="font-bold text-dark">{monthLabel(period.year, period.month)}</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-dark">{totalShifts}</p>
          <p className="text-xs text-gray-400 mt-1">Diensten</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{filledShifts}</p>
          <p className="text-xs text-gray-400 mt-1">Vol</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold" style={{ color: openShifts > 0 ? '#f87369' : '#22c55e' }}>
            {openShifts}
          </p>
          <p className="text-xs text-gray-400 mt-1">Open</p>
        </div>
      </div>

      {/* Pending aanvragen banner — klikbaar */}
      {totalPending > 0 && (
        <button
          onClick={() => setShowPendingPanel(v => !v)}
          className="card p-4 flex items-center gap-3 w-full text-left hover:bg-gray-50/60 transition-colors"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-dark">
              {totalPending} aanvra{totalPending === 1 ? 'ag' : 'gen'} wacht op goedkeuring
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {showPendingPanel ? 'Klik om te sluiten' : 'Klik voor snel overzicht'}
            </p>
          </div>
          <svg className={`w-4 h-4 text-gray-300 transition-transform ${showPendingPanel ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Quick-approve panel */}
      {showPendingPanel && totalPending > 0 && (
        <QuickApprovePanel
          shifts={shifts}
          processing={processing}
          onApprove={approveAssignment}
          onReject={rejectAssignment}
          onApproveAll={approveAll}
        />
      )}

      {/* Zaterdagen toevoegen aan bestaande periode */}
      {missingSaturdays.length > 0 && (
        <div className="card p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-dark">
              {missingSaturdays.length} zaterdag{missingSaturdays.length !== 1 ? 'en' : ''} zonder dienst
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Voeg ze toe met max 1 student per dienst.</p>
          </div>
          <button
            onClick={() => addSaturdays(missingSaturdays)}
            disabled={processing === 'saturdays'}
            className="text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 flex-shrink-0"
            style={{ backgroundColor: '#f87369' }}
          >
            {processing === 'saturdays' ? 'Toevoegen...' : 'Zaterdagen toevoegen'}
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400">
        <span>Klik op een dag om te beheren</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-emerald-300 inline-block" /> Vol</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-amber-200 inline-block" /> Gedeeltelijk</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-rose-200 inline-block" /> Leeg</span>
      </div>

      {/* Calendar grid */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-6 border-b border-gray-100" style={{ backgroundColor: '#3c3c3b' }}>
          {['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'].map((d, i) => (
            <div key={d} className={`py-3 text-center ${i < 5 ? 'border-r border-white/10' : ''}`}>
              <span className="hidden sm:inline text-xs font-semibold text-white/50 uppercase tracking-widest">{d}</span>
              <span className="sm:hidden text-xs font-semibold text-white/50 uppercase tracking-widest">{d.slice(0, 2)}</span>
            </div>
          ))}
        </div>
        <div className="divide-y divide-gray-100">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-6 divide-x divide-gray-100">
              {week.map((day, di) => {
                if (!day) return <div key={di} className="bg-gray-50/40 min-h-[100px]" />
                const iso = dateToISO(day)
                const dayShifts = shiftsByDate[iso] || {}
                const morning = dayShifts['ochtend']
                const afternoon = dayShifts['middag']
                const isSelected = selectedDate === iso
                const isToday = iso === new Date().toISOString().split('T')[0]
                const dayPending = [morning, afternoon].filter(Boolean).reduce((n, s) =>
                  n + (s!.assigned_students || []).filter(a => a.status === 'pending').length, 0)
                const hasShifts = morning || afternoon

                return (
                  <button
                    key={iso}
                    onClick={() => setSelectedDate(isSelected ? null : iso)}
                    className={`p-2.5 sm:p-3 text-left transition-colors min-h-[100px] w-full ${
                      isSelected ? 'bg-dark/[0.06] ring-2 ring-inset ring-dark/20' : hasShifts ? 'hover:bg-gray-50' : 'cursor-default'
                    }`}
                  >
                    {/* Date number */}
                    <div className="flex items-center justify-between mb-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold ${
                        isToday
                          ? 'text-white'
                          : 'text-dark'
                      }`} style={isToday ? { backgroundColor: '#f87369' } : {}}>
                        {day.getDate()}
                      </div>
                      {dayPending > 0 && (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full leading-none">
                          {dayPending}
                        </span>
                      )}
                    </div>
                    {/* Shift blocks */}
                    <div className="space-y-1.5">
                      <ShiftBar shift={morning} label="AM" />
                      <ShiftBar shift={afternoon} label="PM" />
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Selected day panel */}
      {selectedDate && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between" style={{ backgroundColor: '#3c3c3b' }}>
            <p className="font-bold text-white capitalize text-sm">{formatDate(selectedDate)}</p>
            <button onClick={() => setSelectedDate(null)} className="text-white/50 hover:text-white text-xl leading-none">×</button>
          </div>

          {selectedDayShifts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 italic">Geen diensten op deze dag.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {selectedDayShifts.map(shift => {
                const pending = (shift.assigned_students || []).filter(a => a.status === 'pending')
                const approved = (shift.assigned_students || []).filter(a => a.status === 'approved')
                const reserve = (shift.assigned_students || []).filter(a => a.status === 'reserve')
                const isFull = shift.open_spots <= 0
                const isOchtend = shift.shift_type === 'ochtend'
                const unassigned = unassignedStudents(shift)

                return (
                  <div key={shift.id} className="px-5 py-5">
                    {/* Shift header */}
                    <div className="flex items-center gap-2 mb-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        isOchtend ? 'bg-orange-50 text-orange-500' : 'bg-indigo-50 text-indigo-500'
                      }`}>
                        {isOchtend ? 'Ochtend' : 'Middag'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} ({shift.duration_hours}u)
                      </span>
                      <span className={`ml-auto text-xs font-medium px-2.5 py-1 rounded-full ${
                        isFull ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
                      }`}>
                        {shift.assigned_count}/{shift.max_students} goedgekeurd
                      </span>
                      <button
                        onClick={() => setShiftEdit(shiftEdit?.id === shift.id ? null : {
                          id: shift.id,
                          start: shift.start_time.slice(0, 5),
                          end: shift.end_time.slice(0, 5),
                          max: shift.max_students,
                        })}
                        title="Tijden en max. studenten van deze dienst bewerken"
                        className={`p-2 rounded-lg border transition-colors ${
                          shiftEdit?.id === shift.id
                            ? 'border-salmon-300 bg-salmon-50 text-salmon-500'
                            : 'border-gray-200 text-gray-400 hover:text-dark hover:border-gray-300'
                        }`}
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteShift(shift)}
                        disabled={processing === shift.id}
                        title="Dienst verwijderen"
                        className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-50"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Dienst bewerken (tijden + max studenten) */}
                    {shiftEdit?.id === shift.id && (
                      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-500 font-medium">Diensttijd:</span>
                        <input
                          type="time"
                          value={shiftEdit.start}
                          onChange={e => setShiftEdit({ ...shiftEdit, start: e.target.value })}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-salmon-400"
                        />
                        <span className="text-xs text-gray-400">tot</span>
                        <input
                          type="time"
                          value={shiftEdit.end}
                          onChange={e => setShiftEdit({ ...shiftEdit, end: e.target.value })}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-salmon-400"
                        />
                        <span className="text-xs text-gray-400">
                          = {shiftEdit.start && shiftEdit.end && shiftEdit.end > shiftEdit.start ? `${hoursBetween(shiftEdit.start, shiftEdit.end)}u` : '—'}
                        </span>
                        <span className="text-xs text-gray-500 font-medium ml-3">Max:</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={shiftEdit.max}
                          onChange={e => setShiftEdit({ ...shiftEdit, max: Number(e.target.value) })}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white w-14 focus:outline-none focus:border-salmon-400"
                        />
                        <span className="text-xs text-gray-400">studenten</span>
                        <div className="flex gap-2 ml-auto">
                          <button
                            onClick={() => saveShiftEdit(shift)}
                            disabled={processing === shift.id}
                            className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50"
                          >
                            {processing === shift.id ? '...' : 'Opslaan'}
                          </button>
                          <button
                            onClick={() => setShiftEdit(null)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-dark transition-colors"
                          >
                            Annuleer
                          </button>
                        </div>
                        <p className="w-full text-[11px] text-gray-400 mt-1">
                          Geldt voor iedereen op deze dienst — behalve medewerkers met een eigen aangepaste werktijd.
                        </p>
                      </div>
                    )}

                    {/* Pending aanvragen */}
                    {pending.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                          Aanvragen ({pending.length})
                        </p>
                        <div className="space-y-2">
                          {pending.map(s => (
                            <div key={s.user_id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-amber-300" />
                                <span className="text-sm font-semibold text-dark">{s.full_name || s.email}</span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => approveAssignment(s.assignment_id)}
                                  disabled={processing === s.assignment_id}
                                  className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 bg-emerald-500 hover:bg-emerald-600 shadow-sm"
                                >
                                  <CheckMiniIcon className="w-3.5 h-3.5" />
                                  {processing === s.assignment_id ? '...' : 'Goedkeuren'}
                                </button>
                                <button
                                  onClick={() => reserveAssignment(s.assignment_id)}
                                  disabled={processing === s.assignment_id}
                                  title="Op de reservelijst voor deze dienst zetten"
                                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors disabled:opacity-50"
                                >
                                  <BookmarkMiniIcon className="w-3.5 h-3.5" />
                                  Reserve
                                </button>
                                <button
                                  onClick={() => rejectAssignment(s.assignment_id)}
                                  disabled={processing === s.assignment_id}
                                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                >
                                  <XMiniIcon className="w-3.5 h-3.5" />
                                  Afwijzen
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Goedgekeurde studenten */}
                    {approved.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Ingeroosterd ({approved.length})</p>
                        <div className="space-y-2">
                          {approved.map(s => {
                            const m = meta[s.assignment_id]
                            const att = m?.attendance || 'gewerkt'
                            const isCustom = !!(m?.custom_start_time && m?.custom_end_time)
                            const effStart = (m?.custom_start_time || shift.start_time).slice(0, 5)
                            const effEnd = (m?.custom_end_time || shift.end_time).slice(0, 5)
                            const isTimeEditing = timeEdit?.id === s.assignment_id
                            const rowStyle = att === 'ziek'
                              ? 'bg-amber-50 border-amber-100'
                              : att === 'afwezig'
                              ? 'bg-rose-50 border-rose-100'
                              : 'bg-emerald-50 border-emerald-100'
                            const dotStyle = att === 'ziek' ? 'bg-amber-400' : att === 'afwezig' ? 'bg-rose-400' : 'bg-emerald-400'
                            return (
                              <div key={s.user_id} className={`border rounded-xl px-3 py-2.5 ${rowStyle}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotStyle}`} />
                                    <div className="min-w-0">
                                      <span className="text-sm font-semibold text-dark truncate block">{s.full_name || s.email}</span>
                                      <button
                                        onClick={() => setTimeEdit(isTimeEditing ? null : { id: s.assignment_id, start: effStart, end: effEnd })}
                                        title="Werktijden van deze medewerker aanpassen"
                                        className={`text-xs flex items-center gap-1 hover:underline ${isCustom ? 'text-indigo-600 font-semibold' : 'text-gray-400'}`}
                                      >
                                        {effStart} – {effEnd} · {hoursBetween(effStart, effEnd)}u
                                        {isCustom && <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full leading-none">aangepast</span>}
                                        <PencilIcon className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <select
                                      value={att}
                                      onChange={e => markAttendance(s.assignment_id, e.target.value)}
                                      disabled={processing === s.assignment_id}
                                      title="Aanwezigheid voor de urenregistratie"
                                      className="text-xs font-medium border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-dark focus:outline-none focus:border-salmon-400 disabled:opacity-50"
                                    >
                                      <option value="gewerkt">Gewerkt</option>
                                      <option value="ziek">Ziek</option>
                                      <option value="afwezig">Afwezig</option>
                                    </select>
                                    <button
                                      onClick={() => removeAssignment(s.assignment_id)}
                                      disabled={processing === s.assignment_id}
                                      title="Van deze dienst halen"
                                      className="p-2 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                    >
                                      <TrashIcon className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Tijden-editor voor deze medewerker */}
                                {isTimeEditing && timeEdit && (
                                  <div className="mt-2.5 pt-2.5 border-t border-black/5 flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-gray-500 font-medium">Werktijd:</span>
                                    <input
                                      type="time"
                                      value={timeEdit.start}
                                      onChange={e => setTimeEdit({ ...timeEdit, start: e.target.value })}
                                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-salmon-400"
                                    />
                                    <span className="text-xs text-gray-400">tot</span>
                                    <input
                                      type="time"
                                      value={timeEdit.end}
                                      onChange={e => setTimeEdit({ ...timeEdit, end: e.target.value })}
                                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-salmon-400"
                                    />
                                    <span className="text-xs text-gray-400">
                                      = {timeEdit.start && timeEdit.end && timeEdit.end > timeEdit.start ? `${hoursBetween(timeEdit.start, timeEdit.end)}u` : '—'}
                                    </span>
                                    <div className="flex gap-2 ml-auto">
                                      {isCustom && (
                                        <button
                                          onClick={() => resetTimes(s.assignment_id)}
                                          disabled={processing === s.assignment_id}
                                          title={`Terug naar de standaardtijd (${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)})`}
                                          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors disabled:opacity-50"
                                        >
                                          Standaard
                                        </button>
                                      )}
                                      <button
                                        onClick={() => saveTimes(s.assignment_id, shift)}
                                        disabled={processing === s.assignment_id}
                                        className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50"
                                      >
                                        {processing === s.assignment_id ? '...' : 'Opslaan'}
                                      </button>
                                      <button
                                        onClick={() => setTimeEdit(null)}
                                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-dark transition-colors"
                                      >
                                        Annuleer
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Reservelijst voor deze dienst */}
                    {reserve.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-sky-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                          <BookmarkMiniIcon className="w-3.5 h-3.5" />
                          Reservelijst ({reserve.length})
                        </p>
                        <div className="space-y-2">
                          {reserve.map(s => (
                            <div key={s.user_id} className="flex items-center justify-between bg-sky-50 border border-sky-100 rounded-xl px-3 py-2.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-2 h-2 rounded-full bg-sky-400 flex-shrink-0" />
                                <span className="text-sm font-semibold text-dark truncate">{s.full_name || s.email}</span>
                              </div>
                              <div className="flex gap-2 flex-shrink-0">
                                <button
                                  onClick={() => approveAssignment(s.assignment_id)}
                                  disabled={processing === s.assignment_id}
                                  title="Vanaf de reservelijst inroosteren"
                                  className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50 shadow-sm"
                                >
                                  <CheckMiniIcon className="w-3.5 h-3.5" />
                                  {processing === s.assignment_id ? '...' : 'Inroosteren'}
                                </button>
                                <button
                                  onClick={() => removeAssignment(s.assignment_id)}
                                  disabled={processing === s.assignment_id}
                                  title="Van de reservelijst halen"
                                  className="p-2 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Direct inroosteren (als er nog plek is) */}
                    {!isFull && unassigned.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-gray-400 mb-2">Direct inroosteren</p>
                        <div className="flex flex-wrap gap-1.5">
                          {unassigned.map(student => (
                            <button
                              key={student.id}
                              onClick={() => directAssign(shift.id, student.id)}
                              disabled={processing === shift.id + student.id}
                              className="text-xs px-2.5 py-1.5 rounded-xl border font-semibold transition-colors disabled:opacity-50"
                              style={{ borderColor: '#d1d5db', color: '#6b7280', backgroundColor: '#f9fafb' }}
                            >
                              + {student.full_name || student.email.split('@')[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Medewerker op de reservelijst zetten (ook als de dienst vol is) */}
                    {unassigned.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-bold text-sky-500 mb-2">Op reservelijst zetten</p>
                        <div className="flex flex-wrap gap-1.5">
                          {unassigned.map(student => (
                            <button
                              key={student.id}
                              onClick={() => directReserve(shift.id, student.id)}
                              disabled={processing === shift.id + student.id}
                              className="text-xs px-2.5 py-1.5 rounded-xl border border-sky-200 bg-sky-50 text-sky-600 font-semibold hover:bg-sky-100 transition-colors disabled:opacity-50"
                            >
                              + {student.full_name || student.email.split('@')[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {isFull && pending.length === 0 && reserve.length === 0 && (
                      <p className="text-xs font-semibold text-emerald-600">Dienst is vol</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Ontbrekende dienst toevoegen aan deze dag */}
          {missingDayTypes.length > 0 && (
            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/40 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Dienst toevoegen:</span>
              {missingDayTypes.map(t => (
                <button
                  key={t}
                  onClick={() => addShiftToDay(t)}
                  disabled={processing === 'addshift' + t}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-dark hover:border-gray-300 transition-colors disabled:opacity-50"
                >
                  <PlusMiniIcon className="w-3.5 h-3.5" />
                  {processing === 'addshift' + t
                    ? 'Toevoegen...'
                    : t === 'ochtend' ? 'Ochtenddienst' : 'Middagdienst'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QuickApprovePanel({
  shifts, processing, onApprove, onReject, onApproveAll
}: {
  shifts: ShiftWithAssignments[]
  processing: string | null
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onApproveAll: (ids: string[]) => void
}) {
  const rows: { shift: ShiftWithAssignments; student: NonNullable<ShiftWithAssignments['assigned_students']>[number] }[] = []
  for (const s of [...shifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.shift_type.localeCompare(b.shift_type))) {
    for (const st of (s.assigned_students || []).filter(a => a.status === 'pending')) {
      rows.push({ shift: s, student: st })
    }
  }

  const SHIFT_DAYS_NL: Record<string, string> = {
    Monday: 'Maandag', Tuesday: 'Dinsdag', Wednesday: 'Woensdag',
    Thursday: 'Donderdag', Friday: 'Vrijdag', Saturday: 'Zaterdag',
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/60 flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-amber-700 uppercase tracking-widest">
          Snel goedkeuren — {rows.length} openstaand{rows.length === 1 ? '' : 'e'}
        </p>
        <button
          onClick={() => onApproveAll(rows.map(r => r.student.assignment_id))}
          disabled={processing !== null}
          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          Alles goedkeuren
        </button>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(({ shift, student }) => {
          const d = new Date(shift.shift_date + 'T00:00:00')
          const dayNl = SHIFT_DAYS_NL[d.toLocaleDateString('en-US', { weekday: 'long' })] || ''
          const dateStr = `${dayNl} ${d.getDate()} ${d.toLocaleDateString('nl-NL', { month: 'long' })}`
          const isOchtend = shift.shift_type === 'ochtend'
          return (
            <div key={student.assignment_id} className="flex items-center gap-4 px-5 py-3.5">
              {/* Date + type */}
              <div className="w-36 flex-shrink-0">
                <p className="text-xs font-semibold text-dark leading-tight">{dateStr}</p>
                <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mt-1 ${
                  isOchtend ? 'bg-orange-50 text-orange-500' : 'bg-indigo-50 text-indigo-500'
                }`}>
                  {isOchtend ? 'Ochtend' : 'Middag'} · {shift.start_time.slice(0, 5)}
                </span>
              </div>

              {/* Student */}
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full bg-amber-300 flex-shrink-0" />
                <p className="text-sm font-semibold text-dark truncate">
                  {student.full_name || student.email}
                </p>
              </div>

              {/* Capacity */}
              <p className="text-xs text-gray-400 hidden sm:block flex-shrink-0">
                {shift.assigned_count}/{shift.max_students}
              </p>

              {/* Actions */}
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => onApprove(student.assignment_id)}
                  disabled={processing === student.assignment_id}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50 shadow-sm"
                >
                  <CheckMiniIcon className="w-3.5 h-3.5" />
                  {processing === student.assignment_id ? '...' : 'Goedkeuren'}
                </button>
                <button
                  onClick={() => onReject(student.assignment_id)}
                  disabled={processing === student.assignment_id}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-50"
                >
                  <XMiniIcon className="w-3.5 h-3.5" />
                  Afwijzen
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ShiftBar({ shift, label }: { shift?: ShiftWithAssignments; label: string }) {
  if (!shift) return (
    <div className="h-6 rounded-md bg-gray-100/60 flex items-center px-2">
      <span className="text-[9px] text-gray-300 font-semibold">{label}</span>
    </div>
  )

  const pct = shift.max_students > 0 ? shift.assigned_count / shift.max_students : 0
  const pendingCount = (shift.assigned_students || []).filter(a => a.status === 'pending').length
  const reserveCount = (shift.assigned_students || []).filter(a => a.status === 'reserve').length

  const bg = pct >= 1 ? '#d1fae5' : pct > 0 ? '#fef9c3' : '#fee2e2'
  const textColor = pct >= 1 ? '#065f46' : pct > 0 ? '#92400e' : '#9f1239'

  return (
    <div className="h-6 rounded-md flex items-center justify-between px-2 gap-1" style={{ backgroundColor: bg }}>
      <span className="text-[9px] font-bold" style={{ color: textColor }}>{label}</span>
      <div className="flex items-center gap-1 ml-auto">
        <span className="text-[10px] font-bold" style={{ color: textColor }}>
          {shift.assigned_count}/{shift.max_students}
        </span>
        {pendingCount > 0 && (
          <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1 rounded-sm leading-tight">
            +{pendingCount}
          </span>
        )}
        {reserveCount > 0 && (
          <span className="text-[9px] font-bold text-sky-600 bg-sky-100 px-1 rounded-sm leading-tight" title="Op de reservelijst">
            R{reserveCount}
          </span>
        )}
      </div>
    </div>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897l12.682-12.68Z" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  )
}

function CheckMiniIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function XMiniIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function BookmarkMiniIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
    </svg>
  )
}

function PlusMiniIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: '#f87369', borderTopColor: 'transparent' }} />
    </div>
  )
}
