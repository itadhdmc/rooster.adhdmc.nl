import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { SwapDetail } from '../types'

export default function Ruilverzoeken() {
  const { profile } = useAuth()
  const [swaps, setSwaps] = useState<SwapDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  useEffect(() => { if (profile) loadSwaps() }, [profile])

  async function loadSwaps() {
    const { data } = await supabase.rpc('get_my_swaps')
    setSwaps((data as SwapDetail[]) || [])
    setLoading(false)
  }

  async function approveSwap(swapId: string) {
    setProcessing(swapId)
    const { error } = await supabase
      .from('shift_swaps')
      .update({ status: 'employee_approved' })
      .eq('id', swapId)
    if (error) alert('Goedkeuren mislukt: ' + error.message)
    await loadSwaps()
    setProcessing(null)
  }

  async function rejectSwap(swapId: string) {
    setProcessing(swapId)
    const { error } = await supabase.from('shift_swaps').update({ status: 'rejected' }).eq('id', swapId)
    if (error) alert('Afwijzen mislukt: ' + error.message)
    await loadSwaps()
    setProcessing(null)
  }

  async function cancelSwap(swapId: string) {
    setProcessing(swapId)
    const { error } = await supabase.from('shift_swaps').delete().eq('id', swapId)
    if (error) alert('Annuleren mislukt: ' + error.message)
    await loadSwaps()
    setProcessing(null)
  }

  if (!profile) return null

  const actionNeeded = swaps.filter(s => s.target_user_id === profile.id && s.status === 'pending')
  const running = swaps.filter(s =>
    (s.requester_id === profile.id && s.status === 'pending') || s.status === 'employee_approved')
  const finished = swaps.filter(s => s.status === 'admin_approved' || s.status === 'rejected')
  const isEmpty = actionNeeded.length === 0 && running.length === 0 && finished.length === 0

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">Ruilverzoeken</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Een ruil is definitief zodra je collega én de planning akkoord zijn.
          </p>
        </div>
        <Link to="/mijn-rooster"
          className="text-sm font-semibold text-white px-4 py-2 rounded-xl transition-opacity hover:opacity-90 flex-shrink-0"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          Dienst ruilen
        </Link>
      </div>

      {loading ? (
        <Spinner />
      ) : isEmpty ? (
        <div className="card p-14 text-center">
          <p className="text-dark font-semibold">Nog geen ruilverzoeken</p>
          <p className="text-gray-400 text-sm mt-1.5 max-w-sm mx-auto">
            Kun je een ingeplande dienst niet werken? Vraag een collega om met je te ruilen.
          </p>
          <Link to="/mijn-rooster"
            className="inline-block mt-4 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            Dienst ruilen
          </Link>
        </div>
      ) : (
        <>
          {/* Actie nodig */}
          {actionNeeded.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-2">
                Actie nodig ({actionNeeded.length})
              </p>
              <div className="space-y-3">
                {actionNeeded.map(swap => (
                  <div key={swap.id} className="card p-5 border-amber-100">
                    <p className="text-sm font-semibold text-dark">{swap.requester_name} wil met je ruilen</p>
                    <SwapShifts swap={swap} meIsRequester={false} />
                    <SwapProgress swap={swap} meIsRequester={false} otherName={swap.requester_name} />
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => approveSwap(swap.id)}
                        disabled={processing === swap.id}
                        className="text-xs font-semibold text-white px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                      >
                        {processing === swap.id ? '...' : 'Akkoord met ruil'}
                      </button>
                      <button
                        onClick={() => rejectSwap(swap.id)}
                        disabled={processing === swap.id}
                        className="text-xs font-medium px-4 py-2 rounded-xl border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                      >
                        Afwijzen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Lopend */}
          {running.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                Lopend ({running.length})
              </p>
              <div className="space-y-3">
                {running.map(swap => {
                  const meIsRequester = swap.requester_id === profile.id
                  const otherName = meIsRequester ? swap.target_name : swap.requester_name
                  return (
                    <div key={swap.id} className="card p-5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-dark">Ruil met {otherName}</p>
                        {meIsRequester && swap.status === 'pending' && (
                          <button
                            onClick={() => cancelSwap(swap.id)}
                            disabled={processing === swap.id}
                            className="text-xs font-medium text-gray-400 hover:text-rose-500 transition-colors disabled:opacity-50 flex-shrink-0"
                          >
                            {processing === swap.id ? '...' : 'Annuleren'}
                          </button>
                        )}
                      </div>
                      <SwapShifts swap={swap} meIsRequester={meIsRequester} />
                      <SwapProgress swap={swap} meIsRequester={meIsRequester} otherName={otherName} />
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Afgerond */}
          {finished.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                Afgerond ({finished.length})
              </p>
              <div className="card divide-y divide-gray-50">
                {finished.map(swap => {
                  const meIsRequester = swap.requester_id === profile.id
                  const otherName = meIsRequester ? swap.target_name : swap.requester_name
                  const ok = swap.status === 'admin_approved'
                  return (
                    <div key={swap.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-dark truncate">Ruil met {otherName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {fmtDate(swap.req_shift_date)} ↔ {fmtDate(swap.tgt_shift_date)}
                        </p>
                      </div>
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                        ok ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
                      }`}>
                        {ok ? '✓ Uitgevoerd' : 'Afgewezen'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// De twee diensten van een ruil
// ------------------------------------------------------------

function SwapShifts({ swap, meIsRequester }: { swap: SwapDetail; meIsRequester: boolean }) {
  const mine = meIsRequester
    ? { date: swap.req_shift_date, type: swap.req_shift_type, time: swap.req_start_time }
    : { date: swap.tgt_shift_date, type: swap.tgt_shift_type, time: swap.tgt_start_time }
  const theirs = meIsRequester
    ? { date: swap.tgt_shift_date, type: swap.tgt_shift_type, time: swap.tgt_start_time }
    : { date: swap.req_shift_date, type: swap.req_shift_type, time: swap.req_start_time }
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2.5">
      <ShiftChip label="Jouw dienst" {...mine} />
      <span className="text-gray-300 text-sm">↔</span>
      <ShiftChip label="Hun dienst" {...theirs} />
    </div>
  )
}

function ShiftChip({ label, date, type, time }: { label: string; date: string; type: string; time: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-400">{label}:</span>
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
        {fmtDate(date)} · {type} · {time.slice(0, 5)}
      </span>
    </div>
  )
}

// ------------------------------------------------------------
// Visuele voortgang: verzoek → collega → planning → definitief
// ------------------------------------------------------------

function SwapProgress({ swap, meIsRequester, otherName }: { swap: SwapDetail; meIsRequester: boolean; otherName: string }) {
  const colleagueDone = swap.status === 'employee_approved' || swap.status === 'admin_approved'
  const adminDone = swap.status === 'admin_approved'
  const steps = [
    { label: meIsRequester ? 'Jouw verzoek' : `Verzoek van ${otherName.split(' ')[0]}`, state: 'done' as const },
    {
      label: meIsRequester ? `${otherName.split(' ')[0]} akkoord` : 'Jouw akkoord',
      state: colleagueDone ? ('done' as const) : ('active' as const),
    },
    { label: 'Planning', state: adminDone ? ('done' as const) : colleagueDone ? ('active' as const) : ('todo' as const) },
    { label: 'Definitief', state: adminDone ? ('done' as const) : ('todo' as const) },
  ]
  return (
    <div className="flex items-center gap-1.5 mt-3.5 flex-wrap">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1.5">
          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
            s.state === 'done' ? 'text-white' : s.state === 'active' ? 'border-2' : 'border-2 border-gray-200'
          }`}
            style={s.state === 'done' ? { backgroundColor: 'var(--color-primary)' } : s.state === 'active' ? { borderColor: 'var(--color-primary)' } : {}}>
            {s.state === 'done' ? '✓' : ''}
          </span>
          <span className={`text-[11px] ${s.state === 'todo' ? 'text-gray-300' : 'font-semibold text-dark'}`}>
            {s.label}
            {s.state === 'active' && <span className="font-normal text-gray-400"> · wacht</span>}
          </span>
          {i < steps.length - 1 && <span className="w-4 h-px bg-gray-200" />}
        </div>
      ))}
    </div>
  )
}

function fmtDate(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
    </div>
  )
}
