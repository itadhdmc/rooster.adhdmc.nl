import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { RosterPeriod, Shift } from '../types'
import { monthLabel, formatDate } from '../utils/dates'

interface UpcomingShift {
  shift: Shift
  assigned_at: string
}

export default function Dashboard() {
  const { profile, isAdmin, loading: authLoading } = useAuth()
  const [activePeriod, setActivePeriod] = useState<RosterPeriod | null>(null)
  const [upcomingShifts, setUpcomingShifts] = useState<UpcomingShift[]>([])
  const [weekHours, setWeekHours] = useState(0)
  const [monthHours, setMonthHours] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Wacht tot auth klaar is
    if (authLoading) return

    // Auth klaar maar geen profiel - stop laden
    if (!profile) {
      setLoading(false)
      return
    }

    loadDashboard()
  }, [profile, authLoading])

  async function loadDashboard() {
    try {
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1

      const [{ data: periods }, { data: assignments }] = await Promise.all([
        supabase
          .from('roster_periods')
          .select('*')
          .eq('year', year)
          .order('month'),
        supabase
          .from('assignments')
          .select('*, shifts(*)')
          .eq('user_id', profile!.id),
      ])

      const openPeriod = periods?.find(p => p.availability_open || p.second_round_open)
      setActivePeriod(openPeriod || periods?.[0] || null)

      if (assignments && assignments.length > 0) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const weekEnd = new Date(today)
        weekEnd.setDate(weekEnd.getDate() + 7)

        const upcoming = assignments
          .filter(a => {
            const shift = (a as any).shifts as Shift
            if (!shift) return false
            return new Date(shift.shift_date) >= today
          })
          .sort((a, b) => {
            const da = new Date((a as any).shifts.shift_date)
            const db = new Date((b as any).shifts.shift_date)
            return da.getTime() - db.getTime()
          })
          .slice(0, 5)
          .map(a => ({ shift: (a as any).shifts as Shift, assigned_at: a.assigned_at }))

        setUpcomingShifts(upcoming)

        let wh = 0, mh = 0
        for (const a of assignments) {
          const shift = (a as any).shifts as Shift
          if (!shift) continue
          const d = new Date(shift.shift_date)
          if (d >= today && d <= weekEnd) wh += Number(shift.duration_hours)
          if (d.getFullYear() === year && d.getMonth() + 1 === month) mh += Number(shift.duration_hours)
        }
        setWeekHours(wh)
        setMonthHours(mh)
      }
    } catch (err) {
      console.error('Dashboard fout:', err)
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Laden...</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-600">Profiel niet gevonden. Probeer opnieuw in te loggen.</p>
      </div>
    )
  }

  const shiftBadge = (type: string) =>
    type === 'ochtend' ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hallo, {profile.full_name?.split(' ')[0] || 'daar'} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Uren deze week" value={`${weekHours}u`} color="blue" />
        <StatCard label="Uren deze maand" value={`${monthHours}u`} color="green" />
        <StatCard label="Contract min" value={`${profile.contract_min_hours}u/week`} color="gray" />
        <StatCard label="Contract max" value={`${profile.contract_max_hours}u/week`} color="gray" />
      </div>

      {/* Open ronde */}
      {activePeriod && (activePeriod.availability_open || activePeriod.second_round_open) && (
        <div className={`rounded-xl p-5 border-2 ${activePeriod.second_round_open ? 'bg-purple-50 border-purple-200' : 'bg-blue-50 border-blue-200'}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-gray-900">
                {activePeriod.second_round_open ? '🔄 2e ronde open' : '📋 Beschikbaarheid invullen'}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                {activePeriod.second_round_open
                  ? `Er zijn nog open diensten voor ${monthLabel(activePeriod.year, activePeriod.month)}.`
                  : `Geef je beschikbaarheid door voor ${monthLabel(activePeriod.year, activePeriod.month)}.`}
              </p>
              {activePeriod.availability_deadline && (
                <p className="text-xs text-gray-500 mt-1">
                  Deadline: {new Date(activePeriod.availability_deadline).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <Link to="/beschikbaarheid" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors whitespace-nowrap">
              Invullen →
            </Link>
          </div>
        </div>
      )}

      {/* Aankomende diensten */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Aankomende diensten</h2>
          <Link to="/mijn-rooster" className="text-blue-600 text-sm hover:underline">Alles bekijken →</Link>
        </div>
        {upcomingShifts.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200 text-gray-500 text-sm">
            Geen ingeplande diensten.
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingShifts.map(({ shift }) => (
              <div key={shift.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 capitalize">{formatDate(shift.shift_date)}</p>
                  <p className="text-sm text-gray-500">{shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} ({shift.duration_hours}u)</p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${shiftBadge(shift.shift_type)}`}>
                  {shift.shift_type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Admin shortcut */}
      {isAdmin && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-yellow-900">Beheerdersweergave</p>
            <p className="text-sm text-yellow-700">Beheer roosters, studenten en periodes.</p>
          </div>
          <Link to="/admin" className="bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-yellow-600 transition-colors">
            Naar beheer →
          </Link>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    gray: 'bg-gray-50 text-gray-700 border-gray-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-1 opacity-75">{label}</p>
    </div>
  )
}
