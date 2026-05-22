import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { RosterPeriod, Profile } from '../../types'
import { monthLabel } from '../../utils/dates'

export default function AdminDashboard() {
  const [periods, setPeriods] = useState<RosterPeriod[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [stats, setStats] = useState({ totalShifts: 0, openShifts: 0, assignedShifts: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [{ data: pData }, { data: sData }, { data: shiftData }] = await Promise.all([
      supabase.from('roster_periods').select('*').order('year').order('month'),
      supabase.from('profiles').select('*').eq('role', 'student').eq('active', true),
      supabase.from('shifts_with_assignments').select('assigned_count,open_spots'),
    ])
    setPeriods(pData || [])
    setStudents(sData || [])

    const total = (shiftData || []).length
    const open = (shiftData || []).filter(s => s.open_spots > 0).length
    const assigned = total - open
    setStats({ totalShifts: total, openShifts: open, assignedShifts: assigned })
    setLoading(false)
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Beheerderspaneel</h1>
        <Link to="/admin/periodes/nieuw" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          + Nieuwe periode
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Actieve studenten" value={students.length} color="blue" />
        <StatCard label="Totaal diensten" value={stats.totalShifts} color="gray" />
        <StatCard label="Ingevuld" value={stats.assignedShifts} color="green" />
        <StatCard label="Open plekken" value={stats.openShifts} color="red" />
      </div>

      {/* Periodes */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-3">Roosterperiodes</h2>
        {periods.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200 text-gray-500 text-sm">
            Nog geen periodes aangemaakt.{' '}
            <Link to="/admin/periodes/nieuw" className="text-blue-600 hover:underline">Maak de eerste aan →</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {periods.map(period => (
              <PeriodCard key={period.id} period={period} onUpdate={loadData} />
            ))}
          </div>
        )}
      </div>

      {/* Snelkoppelingen */}
      <div className="grid sm:grid-cols-3 gap-4">
        <QuickLink to="/admin/studenten" icon="👥" title="Studenten beheren" desc="Rollen, contracturen, activeer/deactiveer" />
        <QuickLink to="/admin/rooster" icon="📊" title="Rooster overzicht" desc="Alle diensten, bezetting, open plekken" />
        <QuickLink to="/admin/beschikbaarheid" icon="📋" title="Beschikbaarheid" desc="Overzicht van alle ingegeven beschikbaarheid" />
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

  const statusColor = period.roster_published
    ? 'bg-green-100 text-green-700'
    : period.availability_open || period.second_round_open
    ? 'bg-blue-100 text-blue-700'
    : 'bg-gray-100 text-gray-600'

  const statusLabel = period.roster_published
    ? 'Gepubliceerd'
    : period.second_round_open
    ? '2e ronde open'
    : period.availability_open
    ? 'Beschikbaarheid open'
    : 'Gesloten'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-semibold text-gray-900">{monthLabel(period.year, period.month)}</p>
            {period.availability_deadline && (
              <p className="text-xs text-gray-500">
                Deadline: {new Date(period.availability_deadline).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>{statusLabel}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ToggleBtn label="Beschikbaarheid" active={period.availability_open} onClick={() => toggle('availability_open')} disabled={updating} />
          <ToggleBtn label="2e ronde" active={period.second_round_open} onClick={() => toggle('second_round_open')} disabled={updating} />
          <ToggleBtn label="Publiceer" active={period.roster_published} onClick={() => toggle('roster_published')} disabled={updating} color="green" />
          <Link
            to={`/admin/rooster/${period.id}`}
            className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium"
          >
            Beheren →
          </Link>
        </div>
      </div>
    </div>
  )
}

function ToggleBtn({
  label, active, onClick, disabled, color = 'blue'
}: {
  label: string; active: boolean; onClick: () => void; disabled: boolean; color?: string
}) {
  const colors = active
    ? color === 'green' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${colors} disabled:opacity-50`}
    >
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

function QuickLink({ to, icon, title, desc }: { to: string; icon: string; title: string; desc: string }) {
  return (
    <Link to={to} className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all group">
      <div className="text-2xl mb-2">{icon}</div>
      <p className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{title}</p>
      <p className="text-sm text-gray-500 mt-0.5">{desc}</p>
    </Link>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    gray: 'bg-gray-50 text-gray-700 border-gray-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-xs mt-1 opacity-75">{label}</p>
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
