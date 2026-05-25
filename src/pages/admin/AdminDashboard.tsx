import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { RosterPeriod, Profile, SwapDetail } from '../../types'
import { monthLabel } from '../../utils/dates'

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark">Beheerpaneel</h1>
          <p className="text-gray-400 text-sm mt-0.5">Overzicht roosters en studenten</p>
        </div>
        <Link
          to="/admin/periodes/nieuw"
          className="btn-primary text-sm"
        >
          + Nieuwe periode
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Actieve studenten" value={students.length} color="#f87369" />
        <StatCard label="Totaal diensten" value={stats.totalShifts} color="#3c3c3b" />
        <StatCard label="Ingevuld" value={stats.assignedShifts} color="#22c55e" />
        <StatCard label="Open plekken" value={stats.openShifts} color="#f59e0b" />
      </div>

      {/* Quick links */}
      <div className="grid sm:grid-cols-3 gap-3">
        <QuickLink to="/admin/studenten" title="Studenten" desc="Beheer rollen en contracturen" icon={<UsersIcon />} />
        <QuickLink to="/admin/rooster" title="Rooster" desc="Diensten en bezetting" icon={<GridIcon />} />
        <QuickLink to="/admin/beschikbaarheid" title="Beschikbaarheid" desc="Ingegeven beschikbaarheid" icon={<ListIcon />} />
      </div>

      {/* Pending swap approvals */}
      {pendingSwaps.length > 0 && (
        <div>
          <h2 className="font-bold text-dark mb-3 flex items-center gap-2">
            Ruilverzoeken goedkeuren
            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              {pendingSwaps.length}
            </span>
          </h2>
          <div className="space-y-2">
            {pendingSwaps.map(swap => (
              <div key={swap.id} className="card p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-dark">
                    {swap.requester_name} ↔ {swap.target_name}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-500">
                      {new Date(swap.req_shift_date + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' '}({swap.req_shift_type})
                    </span>
                    <span className="text-gray-300 text-xs">↔</span>
                    <span className="text-xs text-gray-500">
                      {new Date(swap.tgt_shift_date + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' '}({swap.tgt_shift_type})
                    </span>
                  </div>
                  <p className="text-xs text-amber-600 mt-1">Beide medewerkers hebben akkoord gegeven</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => approveSwap(swap.id)}
                    disabled={processingSwap === swap.id}
                    className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                  >
                    {processingSwap === swap.id ? '...' : 'Goedkeuren'}
                  </button>
                  <button
                    onClick={() => rejectSwap(swap.id)}
                    disabled={processingSwap === swap.id}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                  >
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
        <h2 className="font-bold text-dark mb-3">Roosterperiodes</h2>
        {periods.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-gray-500 text-sm">
              Nog geen periodes.{' '}
              <Link to="/admin/periodes/nieuw" className="font-semibold" style={{ color: '#f87369' }}>
                Maak de eerste aan →
              </Link>
            </p>
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

  async function toggle(field: 'availability_open' | 'second_round_open' | 'roster_published') {
    setUpdating(true)
    await supabase.from('roster_periods').update({ [field]: !period[field] }).eq('id', period.id)
    onUpdate()
    setUpdating(false)
  }

  const statusLabel = period.roster_published
    ? 'Gepubliceerd'
    : period.second_round_open ? '2e ronde open'
    : period.availability_open ? 'Inschrijving open'
    : 'Gesloten'

  const statusStyle = period.roster_published
    ? { backgroundColor: '#dcfce7', color: '#16a34a' }
    : period.availability_open || period.second_round_open
    ? { backgroundColor: '#fff1f0', color: '#f87369' }
    : { backgroundColor: '#f3f4f6', color: '#6b7280' }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-bold text-dark text-sm">{monthLabel(period.year, period.month)}</p>
            {period.availability_deadline && (
              <p className="text-xs text-gray-400 mt-0.5">
                Deadline: {new Date(period.availability_deadline).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={statusStyle}>
            {statusLabel}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <ToggleBtn label="Inschrijving" active={period.availability_open} onClick={() => toggle('availability_open')} disabled={updating} />
          <ToggleBtn label="2e ronde" active={period.second_round_open} onClick={() => toggle('second_round_open')} disabled={updating} />
          <ToggleBtn label="Publiceer" active={period.roster_published} onClick={() => toggle('roster_published')} disabled={updating} accent="#22c55e" />
          <Link
            to={`/admin/rooster/${period.id}`}
            className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors"
            style={{ backgroundColor: '#f2f2f7', color: '#3c3c3b' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#e5e5ea')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#f2f2f7')}
          >
            Beheren →
          </Link>
        </div>
      </div>
    </div>
  )
}

function ToggleBtn({
  label, active, onClick, disabled, accent = '#f87369',
}: {
  label: string; active: boolean; onClick: () => void; disabled: boolean; accent?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors disabled:opacity-50"
      style={active
        ? { backgroundColor: accent, color: '#fff' }
        : { backgroundColor: '#f3f4f6', color: '#6b7280' }
      }
    >
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

function QuickLink({ to, title, desc, icon }: { to: string; title: string; desc: string; icon: React.ReactNode }) {
  return (
    <Link to={to} className="card p-5 hover:shadow-md transition-shadow block group">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 text-white" style={{ backgroundColor: '#3c3c3b' }}>
        {icon}
      </div>
      <p className="font-bold text-dark text-sm group-hover:text-salmon-500 transition-colors">{title}</p>
      <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
    </Link>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card p-4">
      <p className="text-3xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
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

function UsersIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
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
