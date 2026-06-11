import { useEffect, useState } from 'react'
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

  const incoming = swaps.filter(s => s.target_user_id === profile.id && s.status === 'pending')
  const outgoing = swaps.filter(s => s.requester_id === profile.id && s.status === 'pending')
  const waitingAdmin = swaps.filter(s => s.status === 'employee_approved')
  const isEmpty = incoming.length === 0 && outgoing.length === 0 && waitingAdmin.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark">Ruilverzoeken</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Beheer je ruilverzoeken met collega's. Een ruil is pas definitief nadat je collega
          én de admin hebben goedgekeurd.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: '#f87369', borderTopColor: 'transparent' }} />
        </div>
      ) : isEmpty ? (
        <div className="card p-16 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
            </svg>
          </div>
          <p className="text-gray-500 font-semibold">Geen openstaande ruilverzoeken</p>
          <p className="text-gray-400 text-sm mt-1">Ga naar "Mijn rooster" om een ruilverzoek aan te sturen.</p>
        </div>
      ) : (
        <>
          {/* Incoming requests */}
          {incoming.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                Inkomende verzoeken ({incoming.length})
              </p>
              <div className="card divide-y divide-gray-100">
                {incoming.map(swap => (
                  <div key={swap.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-dark">
                          {swap.requester_name} wil ruilen
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <ShiftLabel
                            label="Jouw dienst"
                            date={swap.tgt_shift_date}
                            type={swap.tgt_shift_type}
                            time={swap.tgt_start_time}
                          />
                          <span className="text-gray-300 text-sm">↔</span>
                          <ShiftLabel
                            label="Hun dienst"
                            date={swap.req_shift_date}
                            type={swap.req_shift_type}
                            time={swap.req_start_time}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0 mt-0.5">
                        <button
                          onClick={() => approveSwap(swap.id)}
                          disabled={processing === swap.id}
                          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                        >
                          {processing === swap.id ? '...' : 'Goedkeuren'}
                        </button>
                        <button
                          onClick={() => rejectSwap(swap.id)}
                          disabled={processing === swap.id}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                        >
                          Afwijzen
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Waiting for admin approval */}
          {waitingAdmin.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                Wacht op admin ({waitingAdmin.length})
              </p>
              <div className="card divide-y divide-gray-100">
                {waitingAdmin.map(swap => {
                  const isRequester = swap.requester_id === profile.id
                  const otherName = isRequester ? swap.target_name : swap.requester_name
                  return (
                    <div key={swap.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-dark">
                            Ruil met {otherName}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <ShiftLabel
                              label={isRequester ? 'Jouw dienst' : 'Hun dienst'}
                              date={swap.req_shift_date}
                              type={swap.req_shift_type}
                              time={swap.req_start_time}
                            />
                            <span className="text-gray-300 text-sm">↔</span>
                            <ShiftLabel
                              label={isRequester ? 'Hun dienst' : 'Jouw dienst'}
                              date={swap.tgt_shift_date}
                              type={swap.tgt_shift_type}
                              time={swap.tgt_start_time}
                            />
                          </div>
                        </div>
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full flex-shrink-0 mt-0.5">
                          Wacht op admin
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Outgoing pending requests */}
          {outgoing.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                Verstuurde verzoeken ({outgoing.length})
              </p>
              <div className="card divide-y divide-gray-100">
                {outgoing.map(swap => (
                  <div key={swap.id} className="px-5 py-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-dark">
                        Verzoek aan {swap.target_name}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <ShiftLabel
                          label="Jouw dienst"
                          date={swap.req_shift_date}
                          type={swap.req_shift_type}
                          time={swap.req_start_time}
                        />
                        <span className="text-gray-300 text-sm">↔</span>
                        <ShiftLabel
                          label="Hun dienst"
                          date={swap.tgt_shift_date}
                          type={swap.tgt_shift_type}
                          time={swap.tgt_start_time}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => cancelSwap(swap.id)}
                      disabled={processing === swap.id}
                      className="text-xs font-medium text-gray-400 hover:text-rose-500 transition-colors disabled:opacity-50 flex-shrink-0 mt-0.5"
                    >
                      {processing === swap.id ? '...' : 'Annuleer'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function ShiftLabel({ label, date, type, time }: {
  label: string; date: string; type: string; time: string
}) {
  const d = new Date(date + 'T00:00:00')
  const dateStr = d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-400">{label}:</span>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        type === 'ochtend' ? 'bg-orange-50 text-orange-500' : 'bg-indigo-50 text-indigo-500'
      }`}>
        {dateStr} · {time.slice(0, 5)}
      </span>
    </div>
  )
}
