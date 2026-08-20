import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Notification } from '../types'

const TYPE_STYLE: Record<string, { bg: string; dot: string }> = {
  shift_approved:    { bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
  shift_rejected:    { bg: 'bg-rose-50',    dot: 'bg-rose-400' },
  shift_reserve:     { bg: 'bg-sky-50',     dot: 'bg-sky-400' },
  admin_pending:     { bg: 'bg-amber-50',   dot: 'bg-amber-400' },
  spot_available:    { bg: 'bg-indigo-50',  dot: 'bg-indigo-400' },
  swap_request:      { bg: 'bg-orange-50',  dot: 'bg-orange-400' },
  swap_approved:     { bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
  swap_rejected:     { bg: 'bg-rose-50',    dot: 'bg-rose-400' },
  reserve_withdrawn: { bg: 'bg-amber-50',   dot: 'bg-amber-400' },
  reserve_removed:   { bg: 'bg-sky-50',     dot: 'bg-sky-400' },
}

// Waar een melding logisch naartoe leidt.
const TYPE_LINK: Record<string, { to: string; label: string }> = {
  admin_pending:     { to: '/admin', label: 'Naar beheer' },
  reserve_withdrawn: { to: '/admin', label: 'Naar beheer' },
  spot_available:    { to: '/beschikbaarheid', label: 'Bekijk dienst' },
  shift_approved:    { to: '/mijn-rooster', label: 'Mijn rooster' },
  shift_rejected:    { to: '/beschikbaarheid', label: 'Inschrijven' },
  shift_reserve:     { to: '/mijn-rooster', label: 'Mijn rooster' },
  reserve_removed:   { to: '/beschikbaarheid', label: 'Inschrijven' },
  swap_request:      { to: '/ruilverzoeken', label: 'Beoordelen' },
  swap_approved:     { to: '/mijn-rooster', label: 'Mijn rooster' },
  swap_rejected:     { to: '/mijn-rooster', label: 'Mijn rooster' },
}

// Vanaf dit aantal gelijksoortige meldingen op één dag bundelen we ze.
const GROUP_THRESHOLD = 3

type DayGroup = {
  day: string
  entries: Array<
    | { kind: 'single'; item: Notification }
    | { kind: 'group'; type: string; title: string; items: Notification[] }
  >
}

export default function Inbox() {
  const { profile } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => { if (profile) load() }, [profile])

  async function load() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile!.id)
      .order('created_at', { ascending: false })
      .limit(200)
    setNotifications(data || [])
    setLoading(false)
    markAllRead(data || [])
  }

  async function markAllRead(items: Notification[]) {
    const unread = items.filter(n => !n.read).map(n => n.id)
    if (!unread.length) return
    await supabase
      .from('notifications')
      .update({ read: true })
      .in('id', unread)
  }

  async function deleteNotification(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    await supabase.from('notifications').delete().eq('id', id)
  }

  // Verwijdert alleen gelezen meldingen — nooit "alles wissen", zodat het
  // niet voelt alsof je administratieve informatie kwijtraakt.
  async function clearRead() {
    setNotifications(prev => prev.filter(n => !n.read))
    await supabase.from('notifications').delete().eq('user_id', profile!.id).eq('read', true)
  }

  const visible = onlyUnread ? notifications.filter(n => !n.read) : notifications
  const unreadCount = notifications.filter(n => !n.read).length

  // Groeperen per dag; binnen een dag worden ≥3 meldingen van hetzelfde
  // type gebundeld tot één uitklapbare regel.
  const dayGroups: DayGroup[] = useMemo(() => {
    const byDay = new Map<string, Notification[]>()
    for (const n of visible) {
      const day = n.created_at.slice(0, 10)
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(n)
    }
    return [...byDay.entries()].map(([day, items]) => {
      const byType = new Map<string, Notification[]>()
      for (const n of items) {
        if (!byType.has(n.type)) byType.set(n.type, [])
        byType.get(n.type)!.push(n)
      }
      const entries: DayGroup['entries'] = []
      // Behoud tijdsvolgorde: loop over de items en voeg een groep toe op
      // de plek van het nieuwste item van dat type.
      const grouped = new Set<string>()
      for (const n of items) {
        const ofType = byType.get(n.type)!
        if (ofType.length >= GROUP_THRESHOLD) {
          if (!grouped.has(n.type)) {
            grouped.add(n.type)
            entries.push({ kind: 'group', type: n.type, title: n.title, items: ofType })
          }
        } else {
          entries.push({ kind: 'single', item: n })
        }
      }
      return { day, entries }
    })
  }, [visible])

  if (loading) return <Spinner />

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">Meldingen</h1>
          <p className="text-gray-400 text-sm mt-0.5">Alles wat er voor jou is gebeurd in het rooster.</p>
        </div>
        {notifications.some(n => n.read) && (
          <button onClick={clearRead} className="text-xs text-gray-400 hover:text-dark transition-colors font-medium mt-1">
            Gelezen meldingen verwijderen
          </button>
        )}
      </div>

      {/* Filter */}
      {notifications.length > 0 && (
        <div className="flex gap-2">
          <FilterChip active={!onlyUnread} onClick={() => setOnlyUnread(false)} label="Alles" />
          <FilterChip active={onlyUnread} onClick={() => setOnlyUnread(true)}
            label={`Ongelezen${unreadCount > 0 ? ` (${unreadCount})` : ''}`} />
        </div>
      )}

      {visible.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="text-base font-bold text-dark">Geen meldingen</h2>
          <p className="text-gray-400 text-sm mt-1">Je bent helemaal bij.</p>
        </div>
      ) : (
        dayGroups.map(({ day, entries }) => (
          <div key={day}>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 capitalize">
              {formatDay(day)}
            </p>
            <div className="card overflow-hidden divide-y divide-gray-50">
              {entries.map((entry, i) => entry.kind === 'single' ? (
                <NotificationRow key={entry.item.id} n={entry.item} onDelete={deleteNotification} />
              ) : (
                <div key={`${day}-${entry.type}-${i}`}>
                  {/* Gebundelde meldingen van hetzelfde type */}
                  <div className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                    <TypeDot type={entry.type} />
                    <button
                      onClick={() => setExpanded(prev => {
                        const next = new Set(prev)
                        const key = `${day}|${entry.type}`
                        if (next.has(key)) next.delete(key); else next.add(key)
                        return next
                      })}
                      className="flex-1 min-w-0 text-left flex items-center gap-3"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-dark">
                          {entry.items.length}× {entry.title}
                        </span>
                        <span className="block text-xs text-gray-400 mt-0.5">
                          {expanded.has(`${day}|${entry.type}`) ? 'Klik om in te klappen' : 'Klik om alle meldingen te bekijken'}
                        </span>
                      </span>
                      <span className="text-gray-300 text-sm flex-shrink-0">
                        {expanded.has(`${day}|${entry.type}`) ? '▴' : '▾'}
                      </span>
                    </button>
                    {entry.items.some(n => !n.read) && <UnreadDot />}
                    {TYPE_LINK[entry.type] && (
                      <Link to={TYPE_LINK[entry.type].to}
                        className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--color-primary)' }}>
                        {TYPE_LINK[entry.type].label} →
                      </Link>
                    )}
                  </div>
                  {expanded.has(`${day}|${entry.type}`) && (
                    <div className="divide-y divide-gray-50 border-t border-gray-50 bg-gray-50/40">
                      {entry.items.map(n => (
                        <NotificationRow key={n.id} n={n} onDelete={deleteNotification} nested />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function NotificationRow({ n, onDelete, nested }: { n: Notification; onDelete: (id: string) => void; nested?: boolean }) {
  const link = TYPE_LINK[n.type]
  return (
    <div className={`flex items-start gap-4 py-3.5 ${nested ? 'pl-14 pr-5' : 'px-5'}`}>
      {!nested && <TypeDot type={n.type} />}
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${!n.read ? 'font-semibold text-dark' : 'font-medium text-gray-500'}`}>{n.title}</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{n.body}</p>
        <div className="flex items-center gap-3 mt-1.5">
          <p className="text-[11px] text-gray-300">
            {new Date(n.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
          </p>
          {link && (
            <Link to={link.to} className="text-[11px] font-semibold" style={{ color: 'var(--color-primary)' }}>
              {link.label} →
            </Link>
          )}
        </div>
      </div>
      {!n.read && <UnreadDot />}
      <button onClick={() => onDelete(n.id)} aria-label="Melding verwijderen"
        className="text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0 mt-0.5 p-1">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function TypeDot({ type }: { type: string }) {
  const style = TYPE_STYLE[type] ?? { bg: 'bg-gray-50', dot: 'bg-gray-400' }
  return (
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${style.bg}`}>
      <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
    </div>
  )
}

function UnreadDot() {
  return <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ backgroundColor: 'var(--color-primary)' }} />
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`text-sm font-medium px-3.5 py-2 rounded-xl border transition-colors ${
        active ? 'text-white border-transparent' : 'bg-white border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300'
      }`}
      style={active ? { backgroundColor: 'var(--color-dark)' } : {}}>
      {label}
    </button>
  )
}

function formatDay(day: string): string {
  const d = new Date(day + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.getTime() === today.getTime()) return 'Vandaag'
  if (d.getTime() === yesterday.getTime()) return 'Gisteren'
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
    </div>
  )
}
