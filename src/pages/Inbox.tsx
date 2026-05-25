import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Notification } from '../types'

const TYPE_ICON: Record<string, { bg: string; dot: string }> = {
  shift_approved:  { bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
  shift_rejected:  { bg: 'bg-rose-50',    dot: 'bg-rose-400' },
  admin_pending:   { bg: 'bg-amber-50',   dot: 'bg-amber-400' },
  spot_available:  { bg: 'bg-indigo-50',  dot: 'bg-indigo-400' },
  swap_request:    { bg: 'bg-orange-50',  dot: 'bg-orange-400' },
  swap_approved:   { bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
  swap_rejected:   { bg: 'bg-rose-50',    dot: 'bg-rose-400' },
}

export default function Inbox() {
  const { profile } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (profile) load() }, [profile])

  async function load() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile!.id)
      .order('created_at', { ascending: false })
      .limit(100)
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

  async function clearAll() {
    setNotifications([])
    await supabase.from('notifications').delete().eq('user_id', profile!.id)
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">Inbox</h1>
          <p className="text-gray-400 text-sm mt-0.5">Jouw meldingen en notificaties.</p>
        </div>
        {notifications.length > 0 && (
          <button onClick={clearAll} className="text-xs text-gray-400 hover:text-dark transition-colors font-medium mt-1">
            Alles wissen
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-dark">Geen meldingen</h2>
          <p className="text-gray-400 text-sm mt-1">Je bent helemaal bij.</p>
        </div>
      ) : (
        <div className="card overflow-hidden divide-y divide-gray-100">
          {notifications.map(n => {
            const style = TYPE_ICON[n.type] ?? { bg: 'bg-gray-50', dot: 'bg-gray-400' }
            return (
              <div key={n.id} className={`flex items-start gap-4 px-5 py-4 ${!n.read ? 'bg-white' : 'bg-gray-50/40'}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${style.bg}`}>
                  <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${!n.read ? 'text-dark' : 'text-gray-500'}`}>{n.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{n.body}</p>
                  <p className="text-[10px] text-gray-300 mt-1.5">
                    {new Date(n.created_at).toLocaleDateString('nl-NL', {
                      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
                {!n.read && (
                  <div className="w-2 h-2 rounded-full bg-salmon-500 flex-shrink-0 mt-1.5" style={{ backgroundColor: '#f87369' }} />
                )}
                <button
                  onClick={() => deleteNotification(n.id)}
                  className="text-gray-300 hover:text-gray-400 transition-colors flex-shrink-0 mt-0.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
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
