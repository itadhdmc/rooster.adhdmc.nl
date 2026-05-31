import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { RosterPeriod, Profile, SwapDetail } from '../../types'
import { monthLabel } from '../../utils/dates'
import { exportPeriodHours } from '../../utils/export'

export default function AdminDashboard() {
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [stats, setStats] = useState({ totalShifts: 0, openShifts: 0, assignedShifts: 0 })
  const [pendingSwaps, setPendingSwaps] = useState<SwapDetail[]>([])
  const [processingSwap, setProcessingSwap] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
      <div className="grid sm:grid-cols-3 gap-3">
        <QuickLink to="/admin/studenten" title="Medewerkers" desc="Beheer rollen en contracturen" icon={<UsersIcon />} accent="#6366f1" />
        <QuickLink to="/admin/beschikbaarheid" title="Beschikbaarheid" desc="Ingegeven beschikbaarheid" icon={<ListIcon />} accent="#f87369" />
        <QuickLink to="/admin/rooster" title="Rooster" desc="Diensten en bezetting" icon={<GridIcon />} accent="#3c3c3b" />
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
              <PeriodCard key={period.id} period={period} onUpdate={loadData} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PeriodCard({ period, onUpdate }: { period: RosterPeriod; onUpdate: () => void }) {
  const [updating, setUpdating] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function toggle(field: 'availability_open' | 'second_round_open' | 'roster_published') {
    setUpdating(true)
    await supabase.from('roster_periods').update({ [field]: !period[field] }).eq('id', period.id)
    onUpdate()
    setUpdating(false)
  }

  async function handleExport() {
    setExporting(true)
    const res = await exportPeriodHours(period)
    setExporting(false)
    if (!res.ok) alert(res.message || 'Export mislukt.')
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
            onClick={handleExport}
            disabled={exporting}
            title="Download gewerkte uren per medewerker (CSV) voor de financiële administratie"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {exporting ? 'Bezig...' : 'Uren export'}
          </button>
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

function ListIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}
