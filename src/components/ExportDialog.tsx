import { useState } from 'react'
import { RosterPeriod } from '../types'
import { monthLabel, dateToISO } from '../utils/dates'
import { exportPeriodHours, exportPeriodDetails, ExportRange, ExportConfig } from '../utils/export'
import { useSettings, pauseConfig, isPremiumDate } from '../hooks/useSettings'

// Eerste en laatste dag van de maand van een periode (ISO).
function monthBounds(period: RosterPeriod): { start: string; end: string } {
  const mm = String(period.month).padStart(2, '0')
  const lastDay = new Date(period.year, period.month, 0).getDate()
  return { start: `${period.year}-${mm}-01`, end: `${period.year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

// De urenexport-dialoog: datumbereik + overzicht- en detail-download.
// Wordt gebruikt op het beheeroverzicht (per periode) én op Financieel,
// zodat de export overal identiek werkt.
export default function ExportDialog({ period, onClose }: { period: RosterPeriod; onClose: () => void }) {
  const { settings } = useSettings()
  const { start, end } = monthBounds(period)
  const [range, setRange] = useState<ExportRange>({ from: start, to: end })
  const [exporting, setExporting] = useState<'overzicht' | 'detail' | null>(null)

  const today = dateToISO(new Date())
  const todayInMonth = today >= start && today <= end
  const isWholeMonth = range.from === start && range.to === end
  const isUntilToday = range.from === start && range.to === today

  async function runExport(kind: 'overzicht' | 'detail') {
    if (!range.from || !range.to || range.to < range.from) {
      alert('De einddatum moet op of na de begindatum liggen.')
      return
    }
    setExporting(kind)
    const cfg: ExportConfig = {
      pause: pauseConfig(settings),
      premiumLabel: settings.premium_label,
      isPremium: iso => isPremiumDate(settings, iso),
    }
    const res = kind === 'overzicht'
      ? await exportPeriodHours(period, range, cfg)
      : await exportPeriodDetails(period, range, cfg)
    setExporting(null)
    if (!res.ok) alert(res.message || 'Export mislukt.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-dark">Uren exporteren</h2>
            <p className="text-xs text-gray-400 mt-0.5 capitalize">{monthLabel(period.year, period.month)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-dark text-2xl leading-none transition-colors">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Periode</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={range.from} min={start} max={end}
                onChange={e => setRange({ ...range, from: e.target.value })}
                className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-salmon-400" />
              <span className="text-xs text-gray-400">t/m</span>
              <input type="date" value={range.to} min={start} max={end}
                onChange={e => setRange({ ...range, to: e.target.value })}
                className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-salmon-400" />
            </div>
            <div className="flex gap-2 mt-2.5">
              <button onClick={() => setRange({ from: start, to: end })}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                  isWholeMonth ? 'border-salmon-300 bg-salmon-50 text-salmon-500' : 'border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300'
                }`}>
                Hele maand
              </button>
              {todayInMonth && (
                <button onClick={() => setRange({ from: start, to: today })}
                  title="Alleen dagen die al voorbij zijn (inclusief vandaag)"
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                    isUntilToday ? 'border-salmon-300 bg-salmon-50 text-salmon-500' : 'border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300'
                  }`}>
                  T/m vandaag
                </button>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Download</p>
            <div className="space-y-2">
              <button onClick={() => runExport('overzicht')} disabled={exporting !== null}
                className="w-full text-left p-3.5 rounded-xl border border-gray-100 hover:border-salmon-300 hover:bg-orange-50/30 transition-colors disabled:opacity-50">
                <p className="text-sm font-semibold text-dark">
                  {exporting === 'overzicht' ? 'Bezig...' : 'Overzicht per medewerker (CSV)'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Uren gesplitst in doordeweeks en toeslagdagen, ziekte- en afwezigheidsuren, plus weektotalen.
                </p>
              </button>
              <button onClick={() => runExport('detail')} disabled={exporting !== null}
                className="w-full text-left p-3.5 rounded-xl border border-gray-100 hover:border-salmon-300 hover:bg-orange-50/30 transition-colors disabled:opacity-50">
                <p className="text-sm font-semibold text-dark">
                  {exporting === 'detail' ? 'Bezig...' : 'Detail per dienst (CSV)'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Eén regel per dienst: datum, dag, week, medewerker, werktijden, uren en aanwezigheid.
                </p>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
