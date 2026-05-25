import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { RosterPeriod, Shift, Availability } from '../types'
import { monthLabel, formatDate } from '../utils/dates'

interface UpcomingShift {
  shift: Shift
  assigned_at: string
}

export default function Dashboard() {
  const { profile, isAdmin, loading: authLoading } = useAuth()
  const [activePeriod, setActivePeriod] = useState<RosterPeriod | null>(null)
  const [myAvailability, setMyAvailability] = useState<Availability[]>([])
  const [upcomingShifts, setUpcomingShifts] = useState<UpcomingShift[]>([])
  const [weekHours, setWeekHours] = useState(0)
  const [monthHours, setMonthHours] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!profile) { setLoading(false); return }
    loadDashboard()
  }, [profile, authLoading])

  async function loadDashboard() {
    try {
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1

      const [{ data: periods }, { data: assignments }] = await Promise.all([
        supabase.from('roster_periods').select('*').eq('year', year).order('month'),
        supabase.from('assignments').select('*, shifts(*)').eq('user_id', profile!.id),
      ])

      const openPeriod = periods?.find(p => p.availability_open || p.second_round_open)
      const active = openPeriod || periods?.[0] || null
      setActivePeriod(active)

      // Laad ingevulde beschikbaarheid voor de actieve periode
      if (active && (active.availability_open || active.second_round_open)) {
        const { data: av } = await supabase
          .from('availability')
          .select('*')
          .eq('user_id', profile!.id)
          .eq('period_id', active.id)
        setMyAvailability(av || [])
      } else {
        setMyAvailability([])
      }

      if (assignments && assignments.length > 0) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const weekEnd = new Date(today)
        weekEnd.setDate(weekEnd.getDate() + 7)

        const upcoming = assignments
          .filter(a => {
            const shift = (a as any).shifts as Shift
            return shift && new Date(shift.shift_date) >= today
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
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: '#f87369', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Profiel niet gevonden. Probeer opnieuw in te loggen.</p>
      </div>
    )
  }

  const ochtendenCount = myAvailability.filter(a => a.shift_type === 'ochtend').length
  const middagenCount = myAvailability.filter(a => a.shift_type === 'middag').length
  const hasSubmittedAvailability = myAvailability.length > 0
  const isOpenPeriod = activePeriod && (activePeriod.availability_open || activePeriod.second_round_open)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark">
            Hallo, {profile.full_name?.split(' ')[0] || 'daar'}
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        {isAdmin && (
          <Link
            to="/admin"
            className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-colors"
            style={{ backgroundColor: '#3c3c3b' }}
          >
            Beheerpaneel →
          </Link>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Uren deze week" value={`${weekHours}u`} accent="#f87369" />
        <StatCard label="Uren deze maand" value={`${monthHours}u`} accent="#3c3c3b" />
        <StatCard label="Contract min" value={`${profile.contract_min_hours}u/w`} accent="#9ca3af" />
        <StatCard label="Contract max" value={`${profile.contract_max_hours}u/w`} accent="#9ca3af" />
      </div>

      {/* Open ronde banner */}
      {isOpenPeriod && activePeriod && (
        hasSubmittedAvailability ? (
          // Bevestiging: al ingevuld
          <div className="rounded-2xl p-5 flex items-start justify-between gap-4 bg-white border-2 border-green-200">
            <div>
              <p className="font-bold text-dark text-base flex items-center gap-2">
                <span className="text-green-500">✓</span>
                Beschikbaarheid ingevuld
              </p>
              <p className="text-gray-500 text-sm mt-1">
                Voor <strong>{monthLabel(activePeriod.year, activePeriod.month)}</strong>: {ochtendenCount} ochtend{ochtendenCount !== 1 ? 'en' : ''} en {middagenCount} middag{middagenCount !== 1 ? 'en' : ''}
              </p>
              {activePeriod.availability_deadline && (
                <p className="text-xs text-gray-400 mt-1">
                  Deadline: {new Date(activePeriod.availability_deadline).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <Link
              to="/beschikbaarheid"
              className="flex-shrink-0 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Wijzigen
            </Link>
          </div>
        ) : (
          // Call to action: nog niet ingevuld
          <div
            className="rounded-2xl p-5 flex items-start justify-between gap-4"
            style={{ backgroundColor: '#f87369' }}
          >
            <div>
              <p className="font-bold text-white text-base">
                {activePeriod.second_round_open ? '2e ronde open' : 'Beschikbaarheid invullen'}
              </p>
              <p className="text-white/80 text-sm mt-1">
                {activePeriod.second_round_open
                  ? `Er zijn nog open diensten voor ${monthLabel(activePeriod.year, activePeriod.month)}.`
                  : `Geef je beschikbaarheid door voor ${monthLabel(activePeriod.year, activePeriod.month)}.`}
              </p>
              {activePeriod.availability_deadline && (
                <p className="text-white/60 text-xs mt-1">
                  Deadline: {new Date(activePeriod.availability_deadline).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <Link
              to="/beschikbaarheid"
              className="flex-shrink-0 bg-white font-semibold text-sm px-4 py-2 rounded-xl transition-colors hover:bg-gray-50"
              style={{ color: '#f87369' }}
            >
              Invullen →
            </Link>
          </div>
        )
      )}

      {/* Aankomende diensten */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-dark text-base">Aankomende diensten</h2>
          <Link to="/mijn-rooster" className="text-sm font-medium" style={{ color: '#f87369' }}>
            Alles bekijken →
          </Link>
        </div>

        {upcomingShifts.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-500 font-medium">Nog geen ingeplande diensten</p>
            <p className="text-gray-400 text-sm mt-1">
              {hasSubmittedAvailability
                ? 'De admin is bezig met het samenstellen van het rooster.'
                : 'Vul je beschikbaarheid in zodat je ingeroosterd kunt worden.'}
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="divide-y divide-gray-50">
              {upcomingShifts.map(({ shift }) => (
                <div key={shift.id} className="px-5 py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                      style={{ backgroundColor: shift.shift_type === 'ochtend' ? '#f87369' : '#3c3c3b' }}
                    >
                      {new Date(shift.shift_date).getDate()}
                    </div>
                    <div>
                      <p className="font-semibold text-dark capitalize text-sm">{formatDate(shift.shift_date)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} · {shift.duration_hours}u
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
                    shift.shift_type === 'ochtend' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {shift.shift_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="card p-4">
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
  )
}
