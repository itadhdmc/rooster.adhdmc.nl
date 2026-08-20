import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { RosterPeriod, SwapDetail } from '../../types'
import { monthLabel, dateToISO } from '../../utils/dates'
import { exportPeriodHours, exportPeriodDetails, ExportRange, ExportConfig } from '../../utils/export'
import { useSettings, pauseConfig, isPremiumDate } from '../../hooks/useSettings'

// Eerste en laatste dag van de maand van een periode (ISO).
function monthBounds(period: RosterPeriod): { start: string; end: string } {
  const mm = String(period.month).padStart(2, '0')
  const lastDay = new Date(period.year, period.month, 0).getDate()
  return { start: `${period.year}-${mm}-01`, end: `${period.year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

interface ShiftSummary {
  period_id: string
  shift_date: string
  assigned_count: number
  open_spots: number
  max_students: number
  assigned_students: { status: string }[] | null
}

export default function AdminDashboard() {
  const { settings } = useSettings()
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [shifts, setShifts] = useState<ShiftSummary[]>([])
  const [pendingSwaps, setPendingSwaps] = useState<SwapDetail[]>([])
  const [processingSwap, setProcessingSwap] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportPeriod, setExportPeriod] = useState<RosterPeriod | null>(null)
  const [expRange, setExpRange] = useState<ExportRange>({ from: '', to: '' })
  const [exporting, setExporting] = useState<'overzicht' | 'detail' | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [{ data: pData }, { data: shiftData }, { data: swapData }] = await Promise.all([
      supabase.from('roster_periods').select('*').order('year').order('month'),
      supabase.from('shifts_with_assignments')
        .select('period_id, shift_date, assigned_count, open_spots, max_students, assigned_students'),
      supabase.rpc('get_employee_approved_swaps'),
    ])
    setPeriods(pData || [])
    setShifts((shiftData || []) as ShiftSummary[])
    setPendingSwaps((swapData as SwapDetail[]) || [])
    setLoading(false)
  }

  async function approveSwap(swapId: string) {
    setProcessingSwap(swapId)
    const { error } = await supabase.rpc('execute_shift_swap', { swap_id: swapId })
    if (error) alert('Ruil goedkeuren mislukt: ' + error.message)
    await loadData()
    setProcessingSwap(null)
  }

  async function rejectSwap(swapId: string) {
    setProcessingSwap(swapId)
    await supabase.from('shift_swaps').update({ status: 'rejected' }).eq('id', swapId)
    await loadData()
    setProcessingSwap(null)
  }

  function openExport(period: RosterPeriod) {
    const { start, end } = monthBounds(period)
    setExpRange({ from: start, to: end })
    setExportPeriod(period)
  }

  async function runExport(kind: 'overzicht' | 'detail') {
    if (!exportPeriod) return
    if (!expRange.from || !expRange.to || expRange.to < expRange.from) {
      alert('De einddatum moet op of na de begindatum liggen.')
      return
    }
    setExporting(kind)
    const cfg: ExportConfig = {
      pause: pauseConfig(settings),
      premiumLabel: settings.premium_label,
      isPremium: iso => isPremiumDate(settings, iso),
    }
    const res = kind === 'overzicht'
      ? await exportPeriodHours(exportPeriod, expRange, cfg)
      : await exportPeriodDetails(exportPeriod, expRange, cfg)
    setExporting(null)
    if (!res.ok) alert(res.message || 'Export mislukt.')
  }

  // ----------------------------------------------------------
  // Cockpit-berekeningen
  // ----------------------------------------------------------

  const todayISO = dateToISO(new Date())
  const in7DaysISO = dateToISO(new Date(Date.now() + 7 * 24 * 3600 * 1000))
  const now = new Date()

  // Focusperiode: de huidige maand; anders de eerstvolgende; anders de laatste.
  const focus = useMemo(() => {
    const current = periods.find(p => p.year === now.getFullYear() && p.month === now.getMonth() + 1)
    const upcoming = periods.find(p => p.year > now.getFullYear() || (p.year === now.getFullYear() && p.month > now.getMonth() + 1))
    return current || upcoming || periods[periods.length - 1] || null
  }, [periods])

  const focusShifts = useMemo(() => focus ? shifts.filter(s => s.period_id === focus.id) : [], [shifts, focus])
  const totalSpots = focusShifts.reduce((n, s) => n + s.max_students, 0)
  const filledSpots = focusShifts.reduce((n, s) => n + s.assigned_count, 0)
  const openSpots = focusShifts.reduce((n, s) => n + s.open_spots, 0)
  const pct = totalSpots > 0 ? Math.round((filledSpots / totalSpots) * 100) : 0

  const criticalShifts = shifts.filter(s =>
    s.open_spots > 0 && s.shift_date >= todayISO && s.shift_date <= in7DaysISO)
  const pendingCount = shifts.reduce((n, s) =>
    n + (s.assigned_students || []).filter(a => a.status === 'pending').length, 0)

  const deadlines = periods
    .filter(p => p.availability_deadline && new Date(p.availability_deadline) > now)
    .map(p => ({ period: p, when: new Date(p.availability_deadline!) }))
    .sort((a, b) => a.when.getTime() - b.when.getTime())

  if (loading) return <Spinner />

  const actions: { label: string; detail: string; to: string; urgent: boolean }[] = []
  if (pendingCount > 0 && focus) actions.push({
    label: `${pendingCount} aanmelding${pendingCount !== 1 ? 'en' : ''} wachten op goedkeuring`,
    detail: 'Beoordeel de aanvragen in Roosterbeheer.',
    to: `/admin/rooster/${focus.id}`, urgent: true,
  })
  if (pendingSwaps.length > 0) actions.push({
    label: `${pendingSwaps.length} ruilverzoek${pendingSwaps.length !== 1 ? 'en' : ''} wachten op jouw beoordeling`,
    detail: 'Beide medewerkers zijn al akkoord.',
    to: '#ruilverzoeken', urgent: true,
  })
  if (criticalShifts.length > 0) actions.push({
    label: `${criticalShifts.length} dienst${criticalShifts.length !== 1 ? 'en' : ''} onderbezet binnen 7 dagen`,
    detail: 'Bekijk of er reserves of vrijwilligers zijn.',
    to: '/admin/inzichten', urgent: true,
  })

  return (
    <div className="space-y-6">
      {/* Kop */}
      <div>
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest capitalize">
          {now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="text-[28px] font-semibold text-dark leading-tight mt-0.5">Overzicht</h1>
      </div>

      {/* Bezetting van de focusperiode */}
      {focus ? (
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-dark capitalize">{monthLabel(focus.year, focus.month)}</h2>
              <p className="text-[13px] text-gray-400 mt-0.5">
                {filledSpots} van {totalSpots} plekken ingevuld in deze periode
              </p>
            </div>
            <p className="text-3xl font-semibold text-dark">{pct}<span className="text-lg text-gray-400">%</span></p>
          </div>
          <div className="h-2 bg-gray-100 rounded-full mt-4 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: 'var(--color-primary)' }} />
          </div>
          <div className="flex items-center gap-5 mt-4 flex-wrap">
            <p className="text-sm text-gray-500">
              <span className="font-semibold text-dark">{openSpots}</span> open plek{openSpots !== 1 ? 'ken' : ''}
            </p>
            {criticalShifts.length > 0 && (
              <p className="text-sm font-medium text-amber-600">
                {criticalShifts.length} kritisch binnen 7 dagen
              </p>
            )}
            <Link to={`/admin/rooster/${focus.id}`} className="text-sm font-semibold ml-auto" style={{ color: 'var(--color-primary)' }}>
              Naar het rooster →
            </Link>
          </div>
        </section>
      ) : (
        <section className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-500 font-semibold text-sm">Nog geen roosterperiodes.</p>
          <Link to="/admin/periodes/nieuw" className="text-sm font-bold mt-2 inline-block" style={{ color: 'var(--color-primary)' }}>
            Maak de eerste aan →
          </Link>
        </section>
      )}

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        {/* Actie nodig */}
        <section className="lg:col-span-2 bg-white rounded-xl border border-gray-100">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="font-semibold text-dark text-sm">Actie nodig</h2>
          </div>
          {actions.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400">
              Niets dat op je wacht — alle aanmeldingen en ruilverzoeken zijn afgehandeld. 🎉
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {actions.map(a => (
                <Link key={a.label}
                  to={a.to.startsWith('#') ? '#' : a.to}
                  onClick={a.to.startsWith('#') ? e => { e.preventDefault(); document.getElementById(a.to.slice(1))?.scrollIntoView({ behavior: 'smooth' }) } : undefined}
                  className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-gray-50 transition-colors group">
                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-dark">{a.label}</span>
                    <span className="block text-[13px] text-gray-400 mt-0.5">{a.detail}</span>
                  </span>
                  <span className="ml-auto text-gray-300 group-hover:text-gray-500 transition-colors">→</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Komende deadlines */}
        <section className="bg-white rounded-xl border border-gray-100">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="font-semibold text-dark text-sm">Komende deadlines</h2>
          </div>
          {deadlines.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400">Geen deadlines gepland.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {deadlines.map(({ period, when }) => (
                <div key={period.id} className="px-5 py-3">
                  <p className="text-sm font-medium text-dark">
                    {when.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} · Inschrijving sluit
                  </p>
                  <p className="text-[13px] text-gray-400 capitalize">{monthLabel(period.year, period.month)}
                    {' · '}{when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Ruilverzoeken die op de planner wachten */}
      {pendingSwaps.length > 0 && (
        <section id="ruilverzoeken" className="bg-white rounded-xl border border-gray-100">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2.5">
            <h2 className="font-semibold text-dark text-sm">Ruilverzoeken goedkeuren</h2>
            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingSwaps.length}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingSwaps.map(swap => (
              <div key={swap.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-dark truncate">{swap.requester_name} ↔ {swap.target_name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className="text-xs text-gray-400">
                      {new Date(swap.req_shift_date + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' ·'} {swap.req_shift_type}
                    </span>
                    <span className="text-gray-300 text-xs">↔</span>
                    <span className="text-xs text-gray-400">
                      {new Date(swap.tgt_shift_date + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' ·'} {swap.tgt_shift_type}
                    </span>
                  </div>
                  <p className="text-[10px] text-amber-500 font-semibold mt-1 uppercase tracking-wide">Beide medewerkers akkoord</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => approveSwap(swap.id)} disabled={processingSwap === swap.id}
                    className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                    {processingSwap === swap.id ? '...' : 'Goedkeuren'}
                  </button>
                  <button onClick={() => rejectSwap(swap.id)} disabled={processingSwap === swap.id}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50 transition-colors">
                    Afwijzen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Roosterperiodes met lifecycle */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400">Roosterperiodes</h2>
          <Link to="/admin/periodes/nieuw"
            className="text-sm font-semibold text-white px-4 py-2 rounded-xl transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            + Nieuwe periode
          </Link>
        </div>
        <div className="space-y-3">
          {[...periods].reverse().map(period => (
            <PeriodCard key={period.id} period={period} onUpdate={loadData} onExport={() => openExport(period)} />
          ))}
        </div>
      </div>

      {/* Export-dialoog: datumbereik + type export */}
      {exportPeriod && (() => {
        const { start, end } = monthBounds(exportPeriod)
        const today = dateToISO(new Date())
        const todayInMonth = today >= start && today <= end
        const isWholeMonth = expRange.from === start && expRange.to === end
        const isUntilToday = expRange.from === start && expRange.to === today
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setExportPeriod(null)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-dark">Uren exporteren</h2>
                  <p className="text-xs text-gray-400 mt-0.5 capitalize">{monthLabel(exportPeriod.year, exportPeriod.month)}</p>
                </div>
                <button onClick={() => setExportPeriod(null)} className="text-gray-400 hover:text-dark text-2xl leading-none transition-colors">×</button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Periode</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="date" value={expRange.from} min={start} max={end}
                      onChange={e => setExpRange({ ...expRange, from: e.target.value })}
                      className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-salmon-400" />
                    <span className="text-xs text-gray-400">t/m</span>
                    <input type="date" value={expRange.to} min={start} max={end}
                      onChange={e => setExpRange({ ...expRange, to: e.target.value })}
                      className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-salmon-400" />
                  </div>
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={() => setExpRange({ from: start, to: end })}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                        isWholeMonth ? 'border-salmon-300 bg-salmon-50 text-salmon-500' : 'border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300'
                      }`}>
                      Hele maand
                    </button>
                    {todayInMonth && (
                      <button onClick={() => setExpRange({ from: start, to: today })}
                        title="Alleen dagen die al voorbij zijn (inclusief vandaag)"
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                          isUntilToday ? 'border-salmon-300 bg-salmon-50 text-salmon-500' : 'border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300'
                        }`}>
                        T/m vandaag
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Download</p>
                  <div className="space-y-2">
                    <button onClick={() => runExport('overzicht')} disabled={exporting !== null}
                      className="w-full text-left p-3.5 rounded-xl border border-gray-100 hover:border-salmon-300 hover:bg-orange-50/30 transition-colors disabled:opacity-50">
                      <p className="text-sm font-semibold text-dark">
                        {exporting === 'overzicht' ? 'Bezig...' : 'Overzicht per medewerker (CSV)'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Uren gesplitst in doordeweeks en toeslagdagen, ziekte- en afwezigheidsuren, plus weektotalen.
                      </p>
                    </button>
                    <button onClick={() => runExport('detail')} disabled={exporting !== null}
                      className="w-full text-left p-3.5 rounded-xl border border-gray-100 hover:border-salmon-300 hover:bg-orange-50/30 transition-colors disabled:opacity-50">
                      <p className="text-sm font-semibold text-dark">
                        {exporting === 'detail' ? 'Bezig...' : 'Detail per dienst (CSV)'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Eén regel per dienst: datum, dag, week, medewerker, werktijden, uren en aanwezigheid.
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ------------------------------------------------------------
// Periode met lifecycle: één duidelijke vervolgstap per status
// ------------------------------------------------------------

function PeriodCard({ period, onUpdate, onExport }: { period: RosterPeriod; onUpdate: () => void; onExport: () => void }) {
  const [updating, setUpdating] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function setFlags(flags: Partial<Pick<RosterPeriod, 'availability_open' | 'second_round_open' | 'roster_published'>>) {
    setUpdating(true)
    await supabase.from('roster_periods').update(flags).eq('id', period.id)
    onUpdate()
    setUpdating(false)
    setMenuOpen(false)
  }

  // Huidige fase + de logische vervolgstap.
  type Phase = { status: string; statusColor: string; step: number; primary?: { label: string; action: () => void } }
  const phase: Phase = period.roster_published
    ? { status: 'Gepubliceerd', statusColor: 'bg-emerald-50 text-emerald-600', step: 4 }
    : period.second_round_open
    ? { status: '2e ronde geopend', statusColor: 'bg-sky-50 text-sky-600', step: 2,
        primary: { label: '2e ronde sluiten', action: () => setFlags({ second_round_open: false }) } }
    : period.availability_open
    ? { status: 'Inschrijving geopend', statusColor: 'bg-sky-50 text-sky-600', step: 1,
        primary: { label: 'Inschrijving sluiten', action: () => setFlags({ availability_open: false }) } }
    : { status: 'Gesloten — klaar om te publiceren', statusColor: 'bg-amber-50 text-amber-600', step: 3,
        primary: { label: 'Rooster publiceren', action: () => setFlags({ roster_published: true }) } }

  const steps = ['Aangemaakt', 'Inschrijving', '2e ronde', 'Publiceren']

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <p className="font-semibold text-dark capitalize">{monthLabel(period.year, period.month)}</p>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${phase.statusColor}`}>{phase.status}</span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {phase.primary && (
            <button onClick={phase.primary.action} disabled={updating}
              className="text-xs font-semibold text-white px-3.5 py-2 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {updating ? '...' : phase.primary.label}
            </button>
          )}
          <Link to={`/admin/rooster/${period.id}`}
            className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors">
            Rooster bekijken
          </Link>
          {period.roster_published && (
            <button onClick={onExport}
              className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors">
              Uren exporteren
            </button>
          )}

          {/* Overige acties */}
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen(!menuOpen)}
              className="w-8 h-8 rounded-xl border border-gray-200 text-gray-400 hover:text-dark hover:border-gray-300 transition-colors text-sm">
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-20 w-56 bg-white rounded-xl border border-gray-100 shadow-lg py-1.5">
                <MenuItem label={period.availability_open ? 'Inschrijving sluiten' : 'Inschrijving heropenen'}
                  onClick={() => setFlags({ availability_open: !period.availability_open })} />
                <MenuItem label={period.second_round_open ? '2e ronde sluiten' : '2e ronde openen'}
                  onClick={() => setFlags({ second_round_open: !period.second_round_open })} />
                <MenuItem label={period.roster_published ? 'Publicatie ongedaan maken' : 'Rooster publiceren'}
                  onClick={() => setFlags({ roster_published: !period.roster_published })} />
                <div className="border-t border-gray-50 my-1" />
                <MenuItem label="Uren exporteren" onClick={() => { setMenuOpen(false); onExport() }} />
                <Link to={`/admin/financien?periode=${period.id}`}
                  className="block px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-dark transition-colors">
                  Financieel dashboard
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lifecycle-stappen */}
      <div className="flex items-center gap-1.5 mt-4">
        {steps.map((label, i) => {
          const done = i < phase.step || (i === 3 && period.roster_published)
          const active = i === phase.step && !period.roster_published
          return (
            <div key={label} className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                  done ? 'text-white' : active ? 'border-2' : 'border-2 border-gray-200 text-transparent'
                }`}
                  style={done ? { backgroundColor: 'var(--color-primary)' } : active ? { borderColor: 'var(--color-primary)' } : {}}>
                  {done ? '✓' : ''}
                </span>
                <span className={`text-[11px] truncate ${done || active ? 'font-semibold text-dark' : 'text-gray-300'}`}>{label}</span>
              </div>
              {i < steps.length - 1 && <div className={`h-px flex-1 ${done ? 'bg-gray-300' : 'bg-gray-100'}`} />}
            </div>
          )
        })}
      </div>

      {period.availability_deadline && !period.roster_published && (
        <p className="text-[13px] text-gray-400 mt-3">
          Inschrijving sluit {new Date(period.availability_deadline).toLocaleDateString('nl-NL', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      )}
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="block w-full text-left px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-dark transition-colors">
      {label}
    </button>
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
