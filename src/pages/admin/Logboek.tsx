import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AuditLogEntry } from '../../types'

const ACTION_STYLE: Record<string, { bg: string; dot: string; label: string }> = {
  aanmelding:   { bg: 'bg-amber-50',   dot: 'bg-amber-400',   label: 'Aanmelding' },
  ingeroosterd: { bg: 'bg-emerald-50', dot: 'bg-emerald-400', label: 'Ingeroosterd' },
  afgewezen:    { bg: 'bg-rose-50',    dot: 'bg-rose-400',    label: 'Afgewezen' },
  verwijderd:   { bg: 'bg-rose-50',    dot: 'bg-rose-400',    label: 'Verwijderd' },
  reservelijst: { bg: 'bg-sky-50',     dot: 'bg-sky-400',     label: 'Reservelijst' },
  werktijden:   { bg: 'bg-indigo-50',  dot: 'bg-indigo-400',  label: 'Werktijden' },
  aanwezigheid: { bg: 'bg-orange-50',  dot: 'bg-orange-400',  label: 'Aanwezigheid' },
  dienst:       { bg: 'bg-gray-100',   dot: 'bg-gray-400',    label: 'Dienst' },
  ruil:         { bg: 'bg-purple-50',  dot: 'bg-purple-400',  label: 'Ruil' },
  instellingen: { bg: 'bg-slate-100',  dot: 'bg-slate-400',   label: 'Instellingen' },
}

const PAGE_SIZE = 100

export default function Logboek() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('')

  useEffect(() => { load() }, [])

  async function load(offset = 0) {
    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .order('occurred_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    const rows = (data || []) as AuditLogEntry[]
    setEntries(prev => offset === 0 ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setLoading(false)
    setLoadingMore(false)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter(e =>
      (!actionFilter || e.action === actionFilter) &&
      (!q || `${e.description} ${e.actor_name} ${e.target_name || ''} ${e.shift_date || ''}`.toLowerCase().includes(q))
    )
  }, [entries, query, actionFilter])

  // Groeperen per dag voor leesbaarheid.
  const byDay = useMemo(() => {
    const map = new Map<string, AuditLogEntry[]>()
    for (const e of filtered) {
      const day = e.occurred_at.slice(0, 10)
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(e)
    }
    return [...map.entries()]
  }, [filtered])

  if (loading) return <Spinner />

  const actionCounts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.action] = (acc[e.action] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link to="/admin" className="text-xs text-gray-400 hover:text-dark transition-colors font-medium">
          ← Beheerpaneel
        </Link>
        <h1 className="text-2xl font-bold text-dark mt-1">Logboek</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Alle roosterwijzigingen: wie deed wat, en wanneer.
        </p>
      </div>

      <div className="grid lg:grid-cols-4 gap-5 items-start">
      {/* Zijkolom: zoeken + filteren op actietype */}
      <div className="space-y-4 order-1 lg:order-2">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Zoek in het logboek…"
          className="w-full border border-gray-200 bg-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-gray-400"
        />
        <div className="card p-2">
          <button onClick={() => setActionFilter('')}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              actionFilter === '' ? 'font-semibold text-dark bg-gray-100' : 'text-gray-500 hover:text-dark hover:bg-gray-50'
            }`}>
            Alle acties <span className="text-gray-300">({entries.length})</span>
          </button>
          {Object.entries(ACTION_STYLE).filter(([key]) => actionCounts[key]).map(([key, st]) => (
            <button key={key} onClick={() => setActionFilter(actionFilter === key ? '' : key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors ${
                actionFilter === key ? 'font-semibold text-dark bg-gray-100' : 'text-gray-500 hover:text-dark hover:bg-gray-50'
              }`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
              <span className="flex-1">{st.label}</span>
              <span className="text-xs text-gray-300">{actionCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      <div className="lg:col-span-3 space-y-5 order-2 lg:order-1">
      {filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="text-base font-bold text-dark">Geen logregels</h2>
          <p className="text-gray-400 text-sm mt-1">
            {entries.length === 0
              ? 'Het logboek vult zich vanaf nu automatisch bij elke roosterwijziging.'
              : 'Niets gevonden met dit filter.'}
          </p>
        </div>
      ) : (
        byDay.map(([day, dayEntries]) => (
          <div key={day}>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 capitalize">
              {new Date(day + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <div className="card overflow-hidden divide-y divide-gray-50">
              {dayEntries.map(e => {
                const style = ACTION_STYLE[e.action] ?? { bg: 'bg-gray-100', dot: 'bg-gray-400', label: e.action }
                return (
                  <div key={e.id} className="flex items-start gap-3.5 px-5 py-3.5">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${style.bg}`}>
                      <div className={`w-2 h-2 rounded-full ${style.dot}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-dark">{e.description}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(e.occurred_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                        {' · door '}<span className="font-semibold">{e.actor_name}</span>
                        {e.shift_date && (
                          <> · dienst {new Date(e.shift_date + 'T00:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                          {e.shift_type ? ` (${e.shift_type})` : ''}</>
                        )}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0 mt-1 ${style.bg} text-gray-500`}>
                      {style.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {hasMore && !query && !actionFilter && (
        <button
          onClick={() => load(entries.length)}
          disabled={loadingMore}
          className="w-full py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:text-dark hover:border-gray-300 transition-colors disabled:opacity-50"
        >
          {loadingMore ? 'Laden...' : 'Meer laden'}
        </button>
      )}
      </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
    </div>
  )
}
