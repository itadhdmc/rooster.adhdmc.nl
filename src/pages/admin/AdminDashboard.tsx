import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { RosterPeriod, Profile, SwapDetail } from '../../types'
import { monthLabel, dateToISO } from '../../utils/dates'
import { exportPeriodHours, exportPeriodDetails, ExportRange, ExportConfig } from '../../utils/export'
import { useSettings, pauseConfig, isPremiumDate } from '../../hooks/useSettings'

// Eerste en laatste dag van de maand van een periode (ISO).
function monthBounds(period: RosterPeriod): { start: string; end: string } {
  const mm = String(period.month).padStart(2, '0')
  const lastDay = new Date(period.year, period.month, 0).getDate()
  return { start: `${period.year}-${mm}-01`, end: `${period.year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

export default function AdminDashboard() {
  const { settings } = useSettings()
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [stats, setStats] = useState({ totalShifts: 0, openShifts: 0, assignedShifts: 0 })
  const [pendingSwaps, setPendingSwaps] = useState<SwapDetail[]>([])
  const [processingSwap, setProcessingSwap] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportPeriod, setExportPeriod] = useState<RosterPeriod | null>(null)
  const [expRange, setExpRange] = useState<ExportRange>({ from: '', to: '' })
  const [exporting, setExporting] = useState<'overzicht' | 'detail' | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [{ data: pData }, { data: sData }, { data: shiftData }, { data: swapData }] = await Promise.all([
      supabase.from('roster_periods').select('*').order('year').order('month'),
      supabase.from('profiles').select('*').eq('role', 'student').eq('active', true),
      supabase.from('shifts_with_assignments').select('assigned_count,open_spots'),
      supabase.rpc('get_employee_approved_swaps'),
    ])
    setPeriods(pData || [])
    setStudents(sData || [])
    setPendingSwaps((swapData as SwapDetail[]) || [])
    const total = (shiftData || []).length
    const open = (shiftData || []).filter(s => s.open_spots > 0).length
    setStats({ totalShifts: total, openShifts: open, assignedShifts: total - open })
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

  if (loading) return <Spinner />

  const today = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6">

      {/* Hero header */}
      <div className="rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        style={{ backgroundColor: '#3c3c3b' }}>
        <div>
          <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-1 capitalize">{today}</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Beheerpaneel</h1>
          <p className="text-white/50 text-sm mt-1">{students.length} actieve medewerkers · {stats.totalShifts} diensten in totaal</p>
        </div>
        <Link
          to="/admin/periodes/nieuw"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors flex-shrink-0"
          style={{ backgroundColor: '#f87369', color: '#fff' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nieuwe periode
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Medewerkers" value={students.length} icon={<UsersIcon />} iconBg="bg-indigo-50" iconColor="text-indigo-400" valueColor="text-dark" />
        <StatCard label="Diensten" value={stats.totalShifts} icon={<CalendarIcon />} iconBg="bg-gray-100" iconColor="text-gray-400" valueColor="text-dark" />
        <StatCard label="Ingevuld" value={stats.assignedShifts} icon={<CheckIcon />} iconBg="bg-emerald-50" iconColor="text-emerald-500" valueColor="text-emerald-600" />
        <StatCard label="Open plekken" value={stats.openShifts} icon={<ClockIcon />} iconBg="bg-amber-50" iconColor="text-amber-400" valueColor="text-amber-600" />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <QuickLink to="/admin/studenten" title="Medewerkers" desc="Beheer rollen en contracturen" icon={<UsersIcon />} accent="#6366f1" />
        <QuickLink to="/admin/beschikbaarheid" title="Beschikbaarheid" desc="Ingegeven beschikbaarheid" icon={<ListIcon />} accent="#f87369" />
        <QuickLink
          to={periods.length > 0 ? `/admin/rooster/${periods[periods.length - 1].id}` : '/admin/periodes/nieuw'}
          title="Rooster" desc="Diensten en bezetting" icon={<GridIcon />} accent="#3c3c3b" />
        <QuickLink to="/admin/inzichten" title="Inzichten" desc="Bezetting, uren en ziekte" icon={<ChartIcon />} accent="#0ea5e9" />
        <QuickLink to="/admin/financien" title="Financieel" desc="Verloonde uren, toeslag en pauzes" icon={<EuroIcon />} accent="#10b981" />
        <QuickLink to="/admin/logboek" title="Logboek" desc="Wie wijzigde wat, en wanneer" icon={<HistoryIcon />} accent="#a855f7" />
        <QuickLink to="/admin/instellingen" title="Instellingen" desc="Organisatie, regels en diensttijden" icon={<GearIcon />} accent="#64748b" />
      </div>

      {/* Pending swap approvals */}
      {pendingSwaps.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <h2 className="font-bold text-dark text-sm">Ruilverzoeken goedkeuren</h2>
              <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                {pendingSwaps.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingSwaps.map(swap => (
              <div key={swap.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-dark truncate">
                    {swap.requester_name} ↔ {swap.target_name}
                  </p>
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
                  <p className="text-[10px] text-amber-500 font-semibold mt-1 uppercase tracking-wide">
                    Beide medewerkers akkoord
                  </p>
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
        </div>
      )}

      {/* Periods */}
      <div>
        <h2 className="font-bold text-dark mb-3 text-sm uppercase tracking-widest text-gray-400">Roosterperiodes</h2>
        {periods.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CalendarIcon className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-gray-500 font-semibold text-sm">Nog geen periodes aangemaakt.</p>
            <Link to="/admin/periodes/nieuw" className="text-sm font-bold mt-2 inline-block" style={{ color: '#f87369' }}>
              Maak de eerste aan →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {periods.map(period => (
              <PeriodCard key={period.id} period={period} onUpdate={loadData} onExport={() => openExport(period)} />
            ))}
          </div>
        )}
      </div>

      {/* Export-dialoog: datumbereik + type export */}
      {exportPeriod && (() => {
        const { start, end } = monthBounds(exportPeriod)
        const todayISO = dateToISO(new Date())
        const todayInMonth = todayISO >= start && todayISO <= end
        const isWholeMonth = expRange.from === start && expRange.to === end
        const isUntilToday = expRange.from === start && expRange.to === todayISO
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
                {/* Bereik */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Periode</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date" value={expRange.from} min={start} max={end}
                      onChange={e => setExpRange({ ...expRange, from: e.target.value })}
                      className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-salmon-400"
                    />
                    <span className="text-xs text-gray-400">t/m</span>
                    <input
                      type="date" value={expRange.to} min={start} max={end}
                      onChange={e => setExpRange({ ...expRange, to: e.target.value })}
                      className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-salmon-400"
                    />
                  </div>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => setExpRange({ from: start, to: end })}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                        isWholeMonth ? 'border-salmon-300 bg-salmon-50 text-salmon-500' : 'border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300'
                      }`}
                    >
                      Hele maand
                    </button>
                    {todayInMonth && (
                      <button
                        onClick={() => setExpRange({ from: start, to: todayISO })}
                        title="Alleen dagen die al voorbij zijn (inclusief vandaag)"
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                          isUntilToday ? 'border-salmon-300 bg-salmon-50 text-salmon-500' : 'border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300'
                        }`}
                      >
                        T/m vandaag
                      </button>
                    )}
                  </div>
                </div>
                {/* Downloads */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Download</p>
                  <div className="space-y-2">
                    <button
                      onClick={() => runExport('overzicht')}
                      disabled={exporting !== null}
                      className="w-full text-left p-3.5 rounded-xl border border-gray-100 hover:border-salmon-300 hover:bg-orange-50/30 transition-colors disabled:opacity-50"
                    >
                      <p className="text-sm font-semibold text-dark">
                        {exporting === 'overzicht' ? 'Bezig...' : 'Overzicht per medewerker (CSV)'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Uren gesplitst in doordeweeks en zaterdag (toeslag), ziekte- en afwezigheidsuren, plus weektotalen.
                      </p>
                    </button>
                    <button
                      onClick={() => runExport('detail')}
                      disabled={exporting !== null}
                      className="w-full text-left p-3.5 rounded-xl border border-gray-100 hover:border-salmon-300 hover:bg-orange-50/30 transition-colors disabled:opacity-50"
                    >
                      <p className="text-sm font-semibold text-dark">
                        {exporting === 'detail' ? 'Bezig...' : 'Detail per dienst (CSV)'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Eén regel per dienst: datum, dag, week, medewerker, werktijden, uren, zaterdag ja/nee en aanwezigheid.
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

function PeriodCard({ period, onUpdate, onExport }: { period: RosterPeriod; onUpdate: () => void; onExport: () => void }) {
  const [updating, setUpdating] = useState(false)

  async function toggle(field: 'availability_open' | 'second_round_open' | 'roster_published') {
    setUpdating(true)
    await supabase.from('roster_periods').update({ [field]: !period[field] }).eq('id', period.id)
    onUpdate()
    setUpdating(false)
  }

  const statusLabel = period.roster_published ? 'Gepubliceerd'
    : period.second_round_open ? '2e ronde'
    : period.availability_open ? 'Inschrijving open'
    : 'Gesloten'

  const statusStyle = period.roster_published
    ? 'bg-emerald-50 text-emerald-600'
    : period.availability_open || period.second_round_open
    ? 'bg-orange-50 text-orange-500'
    : 'bg-gray-100 text-gray-400'

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#f2f2f7' }}>
            <CalendarIcon className="w-5 h-5 text-gray-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-dark text-sm">{monthLabel(period.year, period.month)}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${statusStyle}`}>
                {statusLabel}
              </span>
            </div>
            {period.availability_deadline && (
              <p className="text-xs text-gray-400 mt-0.5">
                Deadline: {new Date(period.availability_deadline).toLocaleDateString('nl-NL', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <ToggleBtn label="Inschrijving" active={period.availability_open} onClick={() => toggle('availability_open')} disabled={updating} />
          <ToggleBtn label="2e ronde" active={period.second_round_open} onClick={() => toggle('second_round_open')} disabled={updating} />
          <ToggleBtn label="Publiceer" active={period.roster_published} onClick={() => toggle('roster_published')} disabled={updating} accent="#22c55e" />
          <button
            onClick={onExport}
            title="Download gewerkte uren (CSV) voor de financiële administratie — met keuze van datumbereik"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Uren export
          </button>
          <Link
            to={`/admin/financien?periode=${period.id}`}
            title="Financieel dashboard: verloonde uren, zaterdagtoeslag en pauzes met grafieken"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
          >
            <EuroIcon className="w-3.5 h-3.5" />
            Financieel
          </Link>
          <Link to={`/admin/rooster/${period.id}`}
            className="text-xs px-3.5 py-1.5 rounded-xl font-semibold bg-dark text-white hover:opacity-80 transition-opacity">
            Beheren →
          </Link>
        </div>
      </div>
    </div>
  )
}

function ToggleBtn({ label, active, onClick, disabled, accent = '#f87369' }: {
  label: string; active: boolean; onClick: () => void; disabled: boolean; accent?: string
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all disabled:opacity-50"
      style={active ? { backgroundColor: accent, color: '#fff' } : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}>
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

function QuickLink({ to, title, desc, icon, accent }: {
  to: string; title: string; desc: string; icon: React.ReactNode; accent: string
}) {
  return (
    <Link to={to} className="card p-5 hover:shadow-md transition-all hover:-translate-y-0.5 block group">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4 text-white flex-shrink-0"
        style={{ backgroundColor: accent }}>
        {icon}
      </div>
      <p className="font-bold text-dark text-sm group-hover:opacity-70 transition-opacity">{title}</p>
      <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
      <p className="text-xs font-semibold mt-3 transition-colors" style={{ color: accent }}>Openen →</p>
    </Link>
  )
}

function StatCard({ label, value, icon, iconBg, iconColor, valueColor }: {
  label: string; value: number; icon: React.ReactNode; iconBg: string; iconColor: string; valueColor: string
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${iconBg}`}>
        <div className={iconColor}>{icon}</div>
      </div>
      <p className={`text-2xl sm:text-3xl font-bold ${valueColor}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
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

function UsersIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function CalendarIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function CheckIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function ClockIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 3v18M14 3v18" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function EuroIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 7.756a4.5 4.5 0 1 0 0 8.488M7.5 10.5h5.25m-5.25 3h5.25" />
      <circle cx="12" cy="12" r="9.25" strokeWidth={1.5} />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5M3.5 12a8.5 8.5 0 1 1 2.6 6.1M3.5 12H1m2.5 0 1.8 1.8" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5V21h4.5v-7.5H3zm6.75-6V21h4.5V7.5h-4.5zm6.75-4.5V21H21V3h-4.5z" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}
