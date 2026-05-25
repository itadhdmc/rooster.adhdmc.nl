import { ReactNode, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { signOut } from '../lib/auth'

interface LayoutProps {
  children: ReactNode
}

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/beschikbaarheid', label: 'Beschikbaarheid', icon: CalendarIcon },
  { to: '/mijn-rooster', label: 'Mijn rooster', icon: ClockIcon },
]

export default function Layout({ children }: LayoutProps) {
  const { profile, isAdmin } = useAuth()
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
      {/* Top navigation */}
      <nav style={{ backgroundColor: '#3c3c3b' }} className="shadow-lg sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo + nav links */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3 flex-shrink-0">
                <img src="/logo.png" alt="ADHDMC" className="h-8 w-auto" />
                <div className="hidden sm:block">
                  <p className="text-white font-bold text-sm leading-tight">ADHDMC</p>
                  <p className="text-white/50 text-xs leading-tight">Rooster</p>
                </div>
              </div>

              <div className="hidden md:flex items-center gap-1">
                {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className={navClass}>
                    <Icon className="w-4 h-4" />
                    {label}
                  </NavLink>
                ))}
                {isAdmin && (
                  <NavLink to="/admin" className={navClass}>
                    <CogIcon className="w-4 h-4" />
                    Beheer
                  </NavLink>
                )}
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {isAdmin && (
                <span className="hidden sm:inline bg-salmon-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  Admin
                </span>
              )}
              <div className="hidden sm:flex items-center gap-3">
                <div className="text-right">
                  <p className="text-white text-sm font-medium leading-tight">
                    {profile?.full_name?.split(' ')[0] || profile?.email?.split('@')[0]}
                  </p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="text-white/60 hover:text-white transition-colors text-sm px-3 py-1.5 rounded-lg hover:bg-white/10"
                >
                  Uitloggen
                </button>
              </div>

              {/* Mobile menu button */}
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden text-white p-2 rounded-lg hover:bg-white/10"
              >
                {menuOpen ? (
                  <XIcon className="w-5 h-5" />
                ) : (
                  <MenuIcon className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 shadow-lg">
            <div className="divide-y divide-gray-100">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={mobileNavClass} onClick={() => setMenuOpen(false)}>
                  <Icon className="w-5 h-5" />
                  {label}
                </NavLink>
              ))}
              {isAdmin && (
                <NavLink to="/admin" className={mobileNavClass} onClick={() => setMenuOpen(false)}>
                  <CogIcon className="w-5 h-5" />
                  Beheer
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
    </div>
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

function CogIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
