import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useSettings, AppSettings, ShiftTypeConfig, tint } from '../../hooks/useSettings'
import { hoursBetween } from '../../utils/shiftTimes'

// ------------------------------------------------------------
// Navigatiestructuur (elke sectie heeft een eigen URL)
// ------------------------------------------------------------

const WEEKDAYS = [
  { value: 1, short: 'MA', label: 'Maandag' },
  { value: 2, short: 'DI', label: 'Dinsdag' },
  { value: 3, short: 'WO', label: 'Woensdag' },
  { value: 4, short: 'DO', label: 'Donderdag' },
  { value: 5, short: 'VR', label: 'Vrijdag' },
  { value: 6, short: 'ZA', label: 'Zaterdag' },
  { value: 7, short: 'ZO', label: 'Zondag' },
]

interface NavItem { key: string; label: string; keywords: string }

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Organisatie',
    items: [
      { key: 'algemeen', label: 'Algemeen', keywords: 'naam organisatie portal url support e-mail contact' },
      { key: 'huisstijl', label: 'Huisstijl', keywords: 'kleur logo branding agenda label primaire donker' },
    ],
  },
  {
    group: 'Planning',
    items: [
      { key: 'rooster', label: 'Rooster', keywords: 'dagen capaciteit plekken maandlimiet inzet weekdagen' },
      { key: 'diensten', label: 'Diensten', keywords: 'diensttijden ochtend middag vroeg laat tijden dagdeel' },
    ],
  },
  {
    group: 'Beheer',
    items: [
      { key: 'loon', label: 'Loon & uren', keywords: 'toeslag zaterdag pauze verloond uren export loonregels' },
      { key: 'email', label: 'E-mail', keywords: 'afzender mail resend berichten meldingen' },
    ],
  },
  {
    group: 'Systeem',
    items: [
      { key: 'beveiliging', label: 'Beveiliging', keywords: 'domein toegang inloggen google sso 2fa' },
      { key: 'logboek', label: 'Logboek', keywords: 'audit wijzigingen geschiedenis wie wat wanneer' },
    ],
  },
]

export default function Instellingen() {
  const { section = 'algemeen' } = useParams<{ section: string }>()
  const navigate = useNavigate()
  const { settings, loaded, reload } = useSettings()
  const [form, setForm] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => { setForm(settings) }, [loaded])

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(settings), [form, settings])

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setSaveError('')
  }

  async function save() {
    if (form.roster_weekdays.length === 0) { setSaveError('Kies minimaal één roosterbare dag.'); return }
    if (form.pause_enabled && form.pause_end <= form.pause_start) { setSaveError('De pauze-eindtijd moet na de starttijd liggen.'); return }
    setSaving(true)
    const { error } = await supabase.from('app_settings').update({
      org_name: form.org_name,
      portal_url: form.portal_url,
      allowed_domain: form.allowed_domain,
      support_email: form.support_email,
      mail_from_name: form.mail_from_name,
      mail_from_email: form.mail_from_email,
      calendar_label: form.calendar_label,
      color_primary: form.color_primary,
      color_dark: form.color_dark,
      monthly_cap_factor: form.monthly_cap_factor,
      pause_enabled: form.pause_enabled,
      pause_start: form.pause_start,
      pause_end: form.pause_end,
      premium_weekdays: form.premium_weekdays,
      premium_label: form.premium_label,
      roster_weekdays: form.roster_weekdays,
      day_capacities: form.day_capacities,
      shift_types: form.shift_types,
    }).eq('id', 1)
    setSaving(false)
    if (error) { setSaveError('Opslaan mislukt: ' + error.message); return }
    await reload()
  }

  // Zoekfilter over de navigatie.
  const q = query.trim().toLowerCase()
  const filteredNav = NAV.map(g => ({
    ...g,
    items: g.items.filter(i => !q || `${i.label} ${i.keywords}`.toLowerCase().includes(q)),
  })).filter(g => g.items.length > 0)

  // Organisatie-status: eenvoudige, eerlijke checks op wat er echt is.
  const checks: { label: string; ok: boolean; to: string }[] = [
    { label: 'Organisatiegegevens', ok: !!(form.org_name && form.portal_url && form.support_email), to: 'algemeen' },
    { label: 'Huisstijl', ok: !!(form.color_primary && form.calendar_label), to: 'huisstijl' },
    { label: 'Roosterdagen en capaciteit', ok: form.roster_weekdays.length > 0 && form.roster_weekdays.every(d => (form.day_capacities[d - 1] ?? 0) > 0), to: 'rooster' },
    { label: 'Diensttijden', ok: form.shift_types.every(t => t.start < t.end), to: 'diensten' },
    { label: 'Loonregels', ok: form.monthly_cap_factor > 0, to: 'loon' },
    { label: 'E-mailafzender', ok: !!(form.mail_from_name && form.mail_from_email.includes('@')), to: 'email' },
    { label: 'Toegangsdomein', ok: form.allowed_domain.includes('.'), to: 'beveiliging' },
  ]
  const pct = Math.round((checks.filter(c => c.ok).length / checks.length) * 100)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/admin" className="text-xs text-gray-400 hover:text-dark transition-colors font-medium">
            ← Beheerpaneel
          </Link>
          <h1 className="text-[28px] font-semibold text-dark mt-1 leading-tight">Instellingen</h1>
          <p className="text-gray-400 text-sm mt-1">Beheer hoe {form.org_name || 'de applicatie'} werkt voor jouw organisatie.</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 mt-1">
          {dirty ? (
            <span className="text-xs font-medium text-amber-600">Niet-opgeslagen wijzigingen</span>
          ) : (
            <span className="text-xs font-medium text-gray-400">✓ Alle wijzigingen opgeslagen</span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="text-sm font-semibold text-white px-5 py-2.5 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {saving ? 'Opslaan...' : 'Wijzigingen opslaan'}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{saveError}</div>
      )}

      {/* Organisatie-status */}
      <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm font-medium text-dark">
            {pct === 100 ? 'Je omgeving is volledig ingesteld' : 'Je omgeving is bijna ingesteld'}
            <span className="ml-2 font-semibold" style={{ color: 'var(--color-primary)' }}>{pct}%</span>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {checks.map(c => (
              <button key={c.label} onClick={() => navigate(`/admin/instellingen/${c.to}`)}
                className={`text-xs flex items-center gap-1 hover:underline ${c.ok ? 'text-gray-400' : 'text-amber-600 font-medium'}`}>
                {c.ok ? '✓' : '!'} {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-1 bg-gray-100 rounded-full mt-3 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: 'var(--color-primary)' }} />
        </div>
      </div>

      {/* Layout: navigatie + inhoud */}
      <div className="flex gap-8 items-start">
        <aside className="w-52 flex-shrink-0 sticky top-20 hidden md:block">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Zoek in instellingen…"
            className="w-full border border-gray-200 bg-white rounded-xl px-3.5 h-10 text-sm mb-5 focus:outline-none focus:border-gray-400"
          />
          <nav className="space-y-5">
            {filteredNav.map(g => (
              <div key={g.group}>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5 px-2.5">{g.group}</p>
                {g.items.map(item => item.key === 'logboek' ? (
                  <Link key={item.key} to="/admin/logboek"
                    className="block px-2.5 py-1.5 rounded-lg text-sm text-gray-500 hover:text-dark hover:bg-gray-100 transition-colors">
                    {item.label} ↗
                  </Link>
                ) : (
                  <button
                    key={item.key}
                    onClick={() => navigate(`/admin/instellingen/${item.key}`)}
                    className={`block w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                      section === item.key
                        ? 'font-semibold text-dark bg-gray-100'
                        : 'text-gray-500 hover:text-dark hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
            {filteredNav.length === 0 && <p className="text-xs text-gray-400 px-2.5">Niets gevonden.</p>}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 max-w-2xl space-y-5">
          {/* Mobiele sectie-kiezer */}
          <div className="md:hidden">
            <select
              value={section}
              onChange={e => e.target.value === 'logboek' ? navigate('/admin/logboek') : navigate(`/admin/instellingen/${e.target.value}`)}
              className="w-full border border-gray-200 bg-white rounded-xl px-3 h-11 text-sm font-medium"
            >
              {NAV.flatMap(g => g.items).map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
          </div>

          {section === 'algemeen' && <AlgemeenPane form={form} set={set} />}
          {section === 'huisstijl' && <HuisstijlPane form={form} set={set} />}
          {section === 'rooster' && <RoosterPane form={form} set={set} />}
          {section === 'diensten' && <DienstenPane form={form} set={set} />}
          {section === 'loon' && <LoonPane form={form} set={set} />}
          {section === 'email' && <EmailPane form={form} set={set} />}
          {section === 'beveiliging' && <BeveiligingPane form={form} set={set} />}
        </main>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Bouwstenen
// ------------------------------------------------------------

type PaneProps = {
  form: AppSettings
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

const inp = 'w-full border border-gray-200 bg-white rounded-xl px-3.5 h-11 text-sm text-dark focus:outline-none focus:border-gray-400 transition-colors'
const inpTime = 'border border-gray-200 bg-white rounded-lg px-2.5 h-10 text-sm text-dark focus:outline-none focus:border-gray-400 disabled:opacity-40'

function Panel({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-100 p-6">
      <h2 className="text-lg font-semibold text-dark">{title}</h2>
      {desc && <p className="text-[13px] text-gray-400 mt-0.5">{desc}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-dark mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[13px] text-gray-400 mt-1.5">{hint}</p>}
    </div>
  )
}

function DayCards({ selected, onToggle }: { selected: number[]; onToggle: (day: number) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {WEEKDAYS.map(d => {
        const active = selected.includes(d.value)
        return (
          <button
            key={d.value}
            type="button"
            onClick={() => onToggle(d.value)}
            title={d.label}
            className={`rounded-xl border py-2.5 text-center transition-all ${
              active ? 'border-transparent text-white shadow-sm' : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-dark'
            }`}
            style={active ? { backgroundColor: 'var(--color-dark)' } : {}}
          >
            <span className="block text-[11px] font-bold tracking-wide">{d.short}</span>
            <span className="block text-[13px] leading-none mt-0.5">{active ? '✓' : '○'}</span>
          </button>
        )
      })}
    </div>
  )
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))}
        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors text-sm font-semibold">−</button>
      <span className="w-8 text-center text-sm font-semibold text-dark">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))}
        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:text-dark hover:border-gray-300 transition-colors text-sm font-semibold">+</button>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-3 group text-left">
      <span
        className="relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: checked ? 'var(--color-primary)' : '#e5e7eb' }}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </span>
      <span className="text-sm text-dark">{label}</span>
    </button>
  )
}

// ------------------------------------------------------------
// Secties
// ------------------------------------------------------------

function AlgemeenPane({ form, set }: PaneProps) {
  return (
    <Panel title="Algemeen" desc="De basisgegevens van je organisatie.">
      <Field label="Organisatienaam">
        <input className={inp} value={form.org_name} onChange={e => set('org_name', e.target.value)} />
      </Field>
      <Field label="Portal-adres" hint="Medewerkers krijgen dit adres in e-mails en meldingen.">
        <input className={inp} value={form.portal_url} onChange={e => set('portal_url', e.target.value)} />
      </Field>
      <Field label="Supportadres" hint="Staat onderaan elke pagina als contactpunt voor vragen en problemen.">
        <input className={inp} value={form.support_email} onChange={e => set('support_email', e.target.value)} />
      </Field>
    </Panel>
  )
}

function HuisstijlPane({ form, set }: PaneProps) {
  return (
    <Panel title="Huisstijl" desc="Wijzigingen zijn direct zichtbaar in het voorbeeld.">
      <div className="grid sm:grid-cols-2 gap-6">
        <div className="space-y-5">
          <Field label="Primaire kleur" hint="Knoppen, accenten en actieve elementen.">
            <div className="flex items-center gap-2">
              <input type="color" value={form.color_primary} onChange={e => set('color_primary', e.target.value)}
                className="w-11 h-11 rounded-xl border border-gray-200 cursor-pointer flex-shrink-0" />
              <input className={inp} value={form.color_primary} onChange={e => set('color_primary', e.target.value)} />
            </div>
          </Field>
          <Field label="Donkere kleur" hint="Navigatie, koppen en sterke contrasten.">
            <div className="flex items-center gap-2">
              <input type="color" value={form.color_dark} onChange={e => set('color_dark', e.target.value)}
                className="w-11 h-11 rounded-xl border border-gray-200 cursor-pointer flex-shrink-0" />
              <input className={inp} value={form.color_dark} onChange={e => set('color_dark', e.target.value)} />
            </div>
          </Field>
          <Field label="Agenda-label" hint='Titel van agenda-afspraken: "Ochtenddienst – [label]".'>
            <input className={inp} value={form.calendar_label} onChange={e => set('calendar_label', e.target.value)} />
          </Field>
        </div>

        {/* Live preview */}
        <div>
          <p className="text-sm font-medium text-dark mb-1.5">Voorbeeld</p>
          <div className="rounded-xl border border-gray-100 overflow-hidden" style={{ backgroundColor: '#f2f2f7' }}>
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ backgroundColor: form.color_dark }}>
              <span className="text-white text-xs font-bold">{form.org_name || 'Organisatie'}</span>
              <span className="text-white/40 text-[10px]">Rooster</span>
            </div>
            <div className="p-4">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Inschrijven voor dienst</p>
                <p className="text-sm font-semibold mt-2" style={{ color: form.color_dark }}>
                  {form.shift_types[0]?.label || 'Ochtend'}dienst
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {form.shift_types[0] ? `${form.shift_types[0].start} – ${form.shift_types[0].end}` : '08:30 – 12:30'}
                </p>
                <button type="button"
                  className="mt-3 w-full text-white text-xs font-bold py-2 rounded-lg cursor-default"
                  style={{ backgroundColor: form.color_primary }}>
                  Inschrijven
                </button>
                <span className="inline-block mt-2.5 text-[10px] font-semibold px-2 py-1 rounded-full"
                  style={{ backgroundColor: tint(form.color_primary, 'white', 0.12), color: form.color_primary }}>
                  Reservelijst
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function RoosterPane({ form, set }: PaneProps) {
  const rosterDays = WEEKDAYS.filter(d => form.roster_weekdays.includes(d.value))
  const caps = rosterDays.map(d => form.day_capacities[d.value - 1] ?? 2)
  const mode = caps.length
    ? [...caps].sort((a, b) => caps.filter(v => v === a).length - caps.filter(v => v === b).length).pop()
    : 2
  const afwijkend = rosterDays.filter(d => (form.day_capacities[d.value - 1] ?? 2) !== mode)
  const exampleMax = 16

  function setCapacity(day: number, value: number) {
    const next = [...form.day_capacities]
    while (next.length < 7) next.push(2)
    next[day - 1] = value
    set('day_capacities', next)
  }

  return (
    <>
      <Panel title="Roosterdagen" desc="Op deze dagen worden diensten ingepland.">
        <DayCards
          selected={form.roster_weekdays}
          onToggle={d => set('roster_weekdays', form.roster_weekdays.includes(d)
            ? form.roster_weekdays.filter(x => x !== d)
            : [...form.roster_weekdays, d].sort())}
        />
      </Panel>

      <Panel title="Capaciteit per dienst" desc="Hoeveel medewerkers er per dienst kunnen werken, per dag.">
        <div className="divide-y divide-gray-50">
          {rosterDays.map(d => (
            <div key={d.value} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-dark">{d.label}</span>
              <Stepper value={form.day_capacities[d.value - 1] ?? 2} min={1} max={20}
                onChange={v => setCapacity(d.value, v)} />
            </div>
          ))}
          {rosterDays.length === 0 && <p className="text-sm text-gray-400 py-2">Kies eerst roosterbare dagen hierboven.</p>}
        </div>
        {afwijkend.length > 0 && (
          <p className="text-[13px] text-gray-400">
            {afwijkend.map(d => d.label).join(' en ')} {afwijkend.length === 1 ? 'heeft' : 'hebben'} een afwijkende
            capaciteit. Medewerkers zien automatisch wanneer een dienst vol is.
          </p>
        )}
      </Panel>

      <Panel title="Maximale inzet per maand">
        <Field label="Factor op het contractmaximum">
          <div className="flex items-center gap-3">
            <input type="number" min={1} max={10} step="0.5" value={form.monthly_cap_factor}
              onChange={e => set('monthly_cap_factor', Number(e.target.value))}
              className="w-24 border border-gray-200 bg-white rounded-xl px-3.5 h-11 text-sm focus:outline-none focus:border-gray-400" />
            <span className="text-sm text-gray-400">× contractmaximum per week</span>
          </div>
        </Field>
        <p className="text-[13px] text-gray-400">
          Een medewerker met een contractmaximum van {exampleMax} uur per week kan hierdoor maximaal{' '}
          <strong className="text-dark">{Math.round(exampleMax * form.monthly_cap_factor * 10) / 10} uur per maand</strong>{' '}
          worden ingepland. De grens wordt bij het goedkeuren automatisch bewaakt.
        </p>
      </Panel>
    </>
  )
}

function DienstenPane({ form, set }: PaneProps) {
  function setType(index: number, patch: Partial<ShiftTypeConfig>) {
    set('shift_types', form.shift_types.map((t, i) => i === index ? { ...t, ...patch } : t))
  }
  function setPreset(index: number, variant: 'early' | 'late', field: 'start' | 'end', value: string) {
    set('shift_types', form.shift_types.map((t, i) =>
      i === index ? { ...t, [variant]: { ...t[variant], [field]: value } } : t))
  }

  return (
    <>
      {form.shift_types.map((t, i) => (
        <Panel key={t.key} title={`${t.label}dienst`}
          desc={`Standaard ${hoursBetween(t.start, t.end).toString().replace('.', ',')} uur per dienst.`}>
          <Field label="Naam">
            <input className={inp} value={t.label} onChange={e => setType(i, { label: e.target.value })} />
          </Field>
          <div className="space-y-3">
            {([
              { key: 'standaard' as const, label: 'Standaard', start: t.start, end: t.end },
              { key: 'early' as const, label: 'Vroeg', start: t.early.start, end: t.early.end },
              { key: 'late' as const, label: 'Laat', start: t.late.start, end: t.late.end },
            ]).map(row => (
              <div key={row.key} className="flex items-center gap-3">
                <span className="w-24 text-sm font-medium text-dark">{row.label}</span>
                <input type="time" className={inpTime} value={row.start}
                  onChange={e => row.key === 'standaard' ? setType(i, { start: e.target.value }) : setPreset(i, row.key, 'start', e.target.value)} />
                <span className="text-gray-300">→</span>
                <input type="time" className={inpTime} value={row.end}
                  onChange={e => row.key === 'standaard' ? setType(i, { end: e.target.value }) : setPreset(i, row.key, 'end', e.target.value)} />
                <span className="text-[13px] text-gray-400 ml-auto">
                  {row.end > row.start ? `${hoursBetween(row.start, row.end).toString().replace('.', ',')}u` : '—'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-gray-400">
            Vroeg en laat zijn de éénklik-varianten in Roosterbeheer, bijvoorbeeld om de dag gespreid te openen en te
            sluiten. Nieuwe tijden gelden voor diensten die je hierna aanmaakt.
          </p>
        </Panel>
      ))}
      <p className="text-[13px] text-gray-400 px-1">
        Meer of andere diensttypes (bijvoorbeeld een avonddienst) staan op de roadmap.
      </p>
    </>
  )
}

function LoonPane({ form, set }: PaneProps) {
  const pauseMin = form.pause_end > form.pause_start ? Math.round(hoursBetween(form.pause_start, form.pause_end) * 60) : 0
  return (
    <>
      <Panel title="Toeslagdagen" desc="Uren op deze dagen worden in exports en dashboards apart geteld, zodat de toeslag direct te berekenen is.">
        <DayCards
          selected={form.premium_weekdays}
          onToggle={d => set('premium_weekdays', form.premium_weekdays.includes(d)
            ? form.premium_weekdays.filter(x => x !== d)
            : [...form.premium_weekdays, d].sort())}
        />
        <Field label="Naam in exports" hint='Bijvoorbeeld "zaterdag" of "weekend" — zo heten de kolommen in de urenexport.'>
          <input className={inp} value={form.premium_label} onChange={e => set('premium_label', e.target.value)} />
        </Field>
      </Panel>

      <Panel title="Pauze bij een volledige dag">
        <div className="flex items-center gap-3 flex-wrap">
          <input type="time" className={inpTime} value={form.pause_start} disabled={!form.pause_enabled}
            onChange={e => set('pause_start', e.target.value)} />
          <span className="text-gray-300">→</span>
          <input type="time" className={inpTime} value={form.pause_end} disabled={!form.pause_enabled}
            onChange={e => set('pause_end', e.target.value)} />
          <span className="text-sm font-medium text-dark">{pauseMin} minuten</span>
        </div>
        <Toggle checked={form.pause_enabled} onChange={v => set('pause_enabled', v)}
          label="Trek deze pauze automatisch af van de verloonde uren" />
        <p className="text-[13px] text-gray-400">
          Geldt alleen voor wie op één dag meerdere dagdelen werkt (een volledige dag). Losse ochtend- of
          middagdiensten krijgen geen aftrek: de middagploeg vangt de pauze van de dagwerkers op.
        </p>
      </Panel>
    </>
  )
}

function EmailPane({ form, set }: PaneProps) {
  return (
    <Panel title="E-mail" desc="Afzender van alle automatische berichten. Het domein moet geverifieerd zijn bij Resend.">
      <div className="grid sm:grid-cols-2 gap-6">
        <div className="space-y-5">
          <Field label="Afzendernaam">
            <input className={inp} value={form.mail_from_name} onChange={e => set('mail_from_name', e.target.value)} />
          </Field>
          <Field label="Afzenderadres">
            <input className={inp} value={form.mail_from_email} onChange={e => set('mail_from_email', e.target.value)} />
          </Field>
        </div>

        {/* Live mailpreview */}
        <div>
          <p className="text-sm font-medium text-dark mb-1.5">Voorbeeld</p>
          <div className="rounded-xl border border-gray-100 bg-white overflow-hidden text-[13px]">
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="text-gray-400 text-[11px]">Van</p>
              <p className="text-dark font-medium truncate">{form.mail_from_name || 'Afzender'} &lt;{form.mail_from_email || 'adres'}&gt;</p>
              <p className="text-gray-400 text-[11px] mt-2">Onderwerp</p>
              <p className="text-dark font-medium">Dienst goedgekeurd – 24-08-2026</p>
            </div>
            <div className="px-4 py-3 text-gray-500 leading-relaxed">
              <p>Hoi Manal,</p>
              <p className="mt-2">
                Je aanvraag voor de <strong className="text-dark">{(form.shift_types[0]?.label || 'ochtend').toLowerCase()}dienst</strong>{' '}
                op <strong className="text-dark">maandag 24 augustus</strong> is goedgekeurd.
              </p>
              <p className="mt-2">
                Bekijk je rooster:{' '}
                <span style={{ color: form.color_primary }}>{form.portal_url.replace(/^https?:\/\//, '')}</span>
              </p>
              <p className="mt-2">Met vriendelijke groet,<br /><strong className="text-dark">{form.mail_from_name || 'Roostersysteem'}</strong></p>
            </div>
          </div>
          <p className="text-[13px] text-gray-400 mt-2">Aanpasbare tekstsjablonen staan op de roadmap.</p>
        </div>
      </div>
    </Panel>
  )
}

function BeveiligingPane({ form, set }: PaneProps) {
  return (
    <>
      <Panel title="Toegang" desc="Wie kan er inloggen op deze omgeving.">
        <Field label="Toegestaan e-maildomein"
          hint="Alleen Google-accounts van dit domein kunnen een account aanmaken. Dit wordt server-side afgedwongen — ook buiten de app om.">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400 flex-shrink-0">@</span>
            <input className={inp} value={form.allowed_domain} onChange={e => set('allowed_domain', e.target.value)} />
          </div>
        </Field>
      </Panel>
      <Panel title="Sessies en verificatie">
        <p className="text-[13px] text-gray-400 leading-relaxed">
          Inloggen verloopt via Google Workspace; wachtwoorden worden niet in deze applicatie opgeslagen en
          tweestapsverificatie volgt het beleid van je Google-organisatie. Aparte SSO- en 2FA-instellingen per
          omgeving staan op de productroadmap.
        </p>
      </Panel>
    </>
  )
}
