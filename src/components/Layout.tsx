import { ReactNode, useEffect, useState } from 'react'
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { supabase } from '../lib/supabase'
import { signOut } from '../lib/auth'

interface LayoutProps {
  children: ReactNode
}

// ------------------------------------------------------------
// Twee contexten: de medewerkeromgeving (bovennavigatie, compact,
// mobielvriendelijk) en de beheeromgeving (zijbalk, desktop-first).
// ------------------------------------------------------------

const EMPLOYEE_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/beschikbaarheid', label: 'Inschrijven', icon: CalendarIcon },
  { to: '/mijn-rooster', label: 'Mijn rooster', icon: ClockIcon },
]

const ADMIN_NAV: { group: string | null; items: { to: string; label: string; end?: boolean }[] }[] = [
  { group: null, items: [{ to: '/admin', label: 'Overzicht', end: true }] },
  {
    group: 'Planning',
    items: [
      { to: '/admin/rooster', label: 'Rooster' },
      { to: '/admin/beschikbaarheid', label: 'Beschikbaarheid' },
    ],
  },
  {
    group: 'Organisatie',
    items: [
      { to: '/admin/studenten', label: 'Medewerkers' },
      { to: '/admin/inzichten', label: 'Inzichten' },
      { to: '/admin/financien', label: 'Financieel' },
    ],
  },
  {
    group: 'Systeem',
    items: [
      { to: '/admin/logboek', label: 'Logboek' },
      { to: '/admin/instellingen', label: 'Instellingen' },
    ],
  },
]

export default function Layout({ children }: LayoutProps) {
  const { profile, isAdmin } = useAuth()
  const location = useLocation()
  const isAdminArea = isAdmin && location.pathname.startsWith('/admin')

  const [unreadCount, setUnreadCount] = useState(0)
  const [swapCount, setSwapCount] = useState(0)

  useEffect(() => {
    if (!profile) return
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('read', false)
      .then(({ count }) => setUnreadCount(count ?? 0))

    // Aantal openstaande ruilverzoeken die op jouw goedkeuring wachten.
    supabase
      .from('shift_swaps')
      .select('id', { count: 'exact', head: true })
      .eq('target_user_id', profile.id)
      .eq('status', 'pending')
      .then(({ count }) => setSwapCount(count ?? 0))

    const channel = supabase
      .channel('inbox-badge')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${profile.id}`,
      }, () => setUnreadCount(c => c + 1))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  return isAdminArea
    ? <AdminShell unreadCount={unreadCount}>{children}</AdminShell>
    : <EmployeeShell unreadCount={unreadCount} swapCount={swapCount} onOpenInbox={() => setUnreadCount(0)}>{children}</EmployeeShell>
}

// ------------------------------------------------------------
// Medewerkeromgeving
// ------------------------------------------------------------

function EmployeeShell({ children, unreadCount, swapCount, onOpenInbox }: {
  children: ReactNode; unreadCount: number; swapCount: number; onOpenInbox: () => void
}) {
  const { profile, isAdmin } = useAuth()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
      isActive
        ? 'bg-salmon-500 text-white shadow-sm'
        : 'text-white/70 hover:bg-white/10 hover:text-white'
    }`

  const mobileNavClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
      isActive
        ? 'text-salmon-500 bg-salmon-50'
        : 'text-dark hover:bg-gray-50'
    }`

  return (
    <div className="min-h-screen bg-surface">
      <nav style={{ backgroundColor: 'var(--color-dark)' }} className="shadow-lg sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3 flex-shrink-0">
                <img src="/logo.png" alt={settings.org_name} className="h-12 w-auto" />
                <div className="hidden sm:block">
                  <p className="text-white font-bold text-sm leading-tight">{settings.org_name}</p>
                  <p className="text-white/50 text-xs leading-tight">Rooster</p>
                </div>
              </div>

              <div className="hidden md:flex items-center gap-1">
                {EMPLOYEE_NAV.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className={navClass}>
                    <Icon className="w-4 h-4" />
                    {label}
                  </NavLink>
                ))}
                <NavLink to="/ruilverzoeken" className={navClass}>
                  <SwapIcon className="w-4 h-4" />
                  Ruilen
                  {swapCount > 0 && (
                    <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded-full leading-none">
                      {swapCount}
                    </span>
                  )}
                </NavLink>
                <NavLink to="/inbox" className={navClass} onClick={onOpenInbox}>
                  <BellIcon className="w-4 h-4" />
                  Meldingen
                  {unreadCount > 0 && (
                    <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded-full leading-none">
                      {unreadCount}
                    </span>
                  )}
                </NavLink>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isAdmin && (
                <Link
                  to="/admin"
                  className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-white/80 hover:text-white border border-white/20 hover:border-white/40 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <SwitchIcon className="w-3.5 h-3.5" />
                  Naar beheer
                </Link>
              )}

              <div className="hidden sm:flex items-center gap-3">
                <p className="text-white text-sm font-medium leading-tight">
                  {profile?.full_name?.split(' ')[0] || profile?.email?.split('@')[0]}
                </p>
                <button
                  onClick={handleSignOut}
                  className="text-white/60 hover:text-white transition-colors text-sm px-3 py-1.5 rounded-lg hover:bg-white/10"
                >
                  Uitloggen
                </button>
              </div>

              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden text-white p-2 rounded-lg hover:bg-white/10"
              >
                {menuOpen ? <XIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobiel menu */}
        {menuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 shadow-lg">
            <div className="divide-y divide-gray-100">
              {EMPLOYEE_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={mobileNavClass} onClick={() => setMenuOpen(false)}>
                  <Icon className="w-5 h-5" />
                  {label}
                </NavLink>
              ))}
              <NavLink to="/ruilverzoeken" className={mobileNavClass} onClick={() => setMenuOpen(false)}>
                <SwapIcon className="w-5 h-5" />
                Ruilen{swapCount > 0 ? ` (${swapCount})` : ''}
              </NavLink>
              <NavLink to="/inbox" className={mobileNavClass} onClick={() => { setMenuOpen(false); onOpenInbox() }}>
                <BellIcon className="w-5 h-5" />
                Meldingen{unreadCount > 0 ? ` (${unreadCount})` : ''}
              </NavLink>
              {isAdmin && (
                <NavLink to="/admin" className={mobileNavClass} onClick={() => setMenuOpen(false)}>
                  <SwitchIcon className="w-5 h-5" />
                  Naar beheer
                </NavLink>
              )}
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-gray-500">{profile?.email}</span>
                <button onClick={handleSignOut} className="text-sm text-salmon-500 font-medium">
                  Uitloggen
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      <Footer />
    </div>
  )
}

// ------------------------------------------------------------
// Beheeromgeving (zijbalk, desktop-first)
// ------------------------------------------------------------

function AdminShell({ children, unreadCount }: { children: ReactNode; unreadCount: number }) {
  const { profile } = useAuth()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [latestPeriodId, setLatestPeriodId] = useState<string | null>(null)

  // Voor de "Rooster"-link: de meest recente periode.
  useEffect(() => {
    supabase.from('roster_periods').select('id').order('year').order('month')
      .then(({ data }) => setLatestPeriodId(data?.length ? data[data.length - 1].id : null))
  }, [])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function resolveTo(to: string): string {
    if (to === '/admin/rooster') return latestPeriodId ? `/admin/rooster/${latestPeriodId}` : '/admin/periodes/nieuw'
    return to
  }

  function isActive(to: string, end?: boolean): boolean {
    if (end) return location.pathname === to
    return location.pathname.startsWith(to)
  }

  const sidebar = (
    <div className="flex flex-col h-full">
      <Link to="/admin" className="flex items-center gap-3 px-5 h-16 flex-shrink-0" onClick={() => setMenuOpen(false)}>
        <img src="/logo.png" alt={settings.org_name} className="h-10 w-auto" />
        <div>
          <p className="text-white font-bold text-sm leading-tight">{settings.org_name}</p>
          <p className="text-white/50 text-xs leading-tight">Beheer</p>
        </div>
      </Link>

      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {ADMIN_NAV.map(g => (
          <div key={g.group ?? 'root'}>
            {g.group && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 px-2.5 mb-1">{g.group}</p>
            )}
            {g.items.map(item => (
              <Link
                key={item.to}
                to={resolveTo(item.to)}
                onClick={() => setMenuOpen(false)}
                className={`block px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  isActive(item.to, item.end)
                    ? 'bg-white/15 text-white font-semibold'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 px-2.5 mb-1">Persoonlijk</p>
          <Link to="/inbox" onClick={() => setMenuOpen(false)}
            className="flex items-center justify-between px-2.5 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
            Meldingen
            {unreadCount > 0 && (
              <span className="text-[10px] font-bold bg-white/20 text-white px-1.5 py-0.5 rounded-full leading-none">{unreadCount}</span>
            )}
          </Link>
        </div>
      </nav>

      {/* Gebruiker + weergave-wisselaar */}
      <div className="px-3 py-4 border-t border-white/10 flex-shrink-0">
        <div className="px-2.5 mb-2.5">
          <p className="text-white text-sm font-semibold leading-tight">{profile?.full_name || profile?.email}</p>
          <p className="text-white/40 text-xs mt-0.5">Administrator</p>
        </div>
        <Link to="/dashboard" onClick={() => setMenuOpen(false)}
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
          <SwitchIcon className="w-4 h-4" />
          Medewerkerweergave
        </Link>
        <button onClick={handleSignOut}
          className="w-full text-left px-2.5 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
          Uitloggen
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-surface">
      {/* Desktop-zijbalk */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 z-30" style={{ backgroundColor: 'var(--color-dark)' }}>
        {sidebar}
      </aside>

      {/* Mobiele topbalk */}
      <div className="lg:hidden sticky top-0 z-30 h-14 flex items-center justify-between px-4" style={{ backgroundColor: 'var(--color-dark)' }}>
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt={settings.org_name} className="h-8 w-auto" />
          <p className="text-white font-bold text-sm">Beheer</p>
        </div>
        <button onClick={() => setMenuOpen(!menuOpen)} className="text-white p-2 rounded-lg hover:bg-white/10">
          {menuOpen ? <XIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
        </button>
      </div>
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64" style={{ backgroundColor: 'var(--color-dark)' }}>
            {sidebar}
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-8">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  )
}

function Footer() {
  const { settings } = useSettings()
  return (
    <footer className="border-t border-gray-100 mt-4">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-xs text-gray-400">{settings.org_name} · Roostersysteem</p>
        <p className="text-xs text-gray-400">
          Vragen of problemen?{' '}
          <a href={`mailto:${settings.support_email}`} className="font-semibold text-dark hover:text-salmon-500 transition-colors">
            {settings.support_email}
          </a>
        </p>
      </div>
    </footer>
  )
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function SwapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
    </svg>
  )
}

function SwitchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
    </svg>
  )
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  )
}
