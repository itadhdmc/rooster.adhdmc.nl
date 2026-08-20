import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useSettings, AppSettings, ShiftTypeConfig } from '../../hooks/useSettings'

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'ma' }, { value: 2, label: 'di' }, { value: 3, label: 'wo' },
  { value: 4, label: 'do' }, { value: 5, label: 'vr' }, { value: 6, label: 'za' }, { value: 7, label: 'zo' },
]

export default function Instellingen() {
  const { settings, loaded, reload } = useSettings()
  const [form, setForm] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setForm(settings) }, [loaded])

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setSaved(false)
  }

  function toggleDay(key: 'premium_weekdays' | 'single_staff_weekdays' | 'roster_weekdays', day: number) {
    const current = form[key]
    set(key, current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort())
  }

  function setShiftType(index: number, patch: Partial<ShiftTypeConfig>) {
    set('shift_types', form.shift_types.map((t, i) => i === index ? { ...t, ...patch } : t))
  }

  function setShiftPreset(index: number, variant: 'early' | 'late', field: 'start' | 'end', value: string) {
    set('shift_types', form.shift_types.map((t, i) =>
      i === index ? { ...t, [variant]: { ...t[variant], [field]: value } } : t))
  }

  async function save() {
    if (form.roster_weekdays.length === 0) { alert('Kies minimaal één roosterbare dag.'); return }
    if (form.pause_enabled && form.pause_end <= form.pause_start) { alert('De pauze-eindtijd moet na de starttijd liggen.'); return }
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
      single_staff_weekdays: form.single_staff_weekdays,
      roster_weekdays: form.roster_weekdays,
      default_max_students: form.default_max_students,
      shift_types: form.shift_types,
    }).eq('id', 1)
    setSaving(false)
    if (error) { alert('Opslaan mislukt: ' + error.message + '\n\nIs migratie 0022 al uitgevoerd?'); return }
    await reload()
    setSaved(true)
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/admin" className="text-xs text-gray-400 hover:text-dark transition-colors font-medium">
            ← Beheerpaneel
          </Link>
          <h1 className="text-2xl font-bold text-dark mt-1">Instellingen</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Organisatie, regels en diensttijden — wijzigingen gelden direct voor iedereen.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="text-sm font-semibold text-white px-5 py-2.5 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50 flex-shrink-0"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {saving ? 'Opslaan...' : saved ? '✓ Opgeslagen' : 'Opslaan'}
        </button>
      </div>

      {/* Organisatie */}
      <Section title="Organisatie" desc="Naam, domein en contact.">
        <Field label="Organisatienaam">
          <input className={inp} value={form.org_name} onChange={e => set('org_name', e.target.value)} />
        </Field>
        <Field label="Portal-URL" hint="Wordt gebruikt in de e-mails naar medewerkers.">
          <input className={inp} value={form.portal_url} onChange={e => set('portal_url', e.target.value)} />
        </Field>
        <Field label="Toegestaan e-maildomein" hint="Alleen accounts @dit-domein kunnen inloggen (server-side afgedwongen).">
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-400">@</span>
            <input className={inp} value={form.allowed_domain} onChange={e => set('allowed_domain', e.target.value)} />
          </div>
        </Field>
        <Field label="Support e-mailadres">
          <input className={inp} value={form.support_email} onChange={e => set('support_email', e.target.value)} />
        </Field>
        <Field label="Agenda-label" hint='Titel van agenda-afspraken: "Ochtenddienst – <label>".'>
          <input className={inp} value={form.calendar_label} onChange={e => set('calendar_label', e.target.value)} />
        </Field>
      </Section>

      {/* E-mail */}
      <Section title="E-mail" desc="Afzender van alle automatische mails (Resend).">
        <Field label="Afzendernaam">
          <input className={inp} value={form.mail_from_name} onChange={e => set('mail_from_name', e.target.value)} />
        </Field>
        <Field label="Afzenderadres" hint="Het domein moet geverifieerd zijn bij Resend.">
          <input className={inp} value={form.mail_from_email} onChange={e => set('mail_from_email', e.target.value)} />
        </Field>
      </Section>

      {/* Kleuren */}
      <Section title="Kleuren" desc="Huisstijl van de applicatie.">
        <Field label="Primaire kleur (accenten en knoppen)">
          <div className="flex items-center gap-2">
            <input type="color" value={form.color_primary} onChange={e => set('color_primary', e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
            <input className={inp} value={form.color_primary} onChange={e => set('color_primary', e.target.value)} />
          </div>
        </Field>
        <Field label="Donkere kleur (navigatie en koppen)">
          <div className="flex items-center gap-2">
            <input type="color" value={form.color_dark} onChange={e => set('color_dark', e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
            <input className={inp} value={form.color_dark} onChange={e => set('color_dark', e.target.value)} />
          </div>
        </Field>
      </Section>

      {/* Rooster-regels */}
      <Section title="Roosterregels" desc="Welke dagen geroosterd worden en hoeveel mensen er per dienst kunnen.">
        <Field label="Roosterbare dagen">
          <DayPicker selected={form.roster_weekdays} onToggle={d => toggleDay('roster_weekdays', d)} />
        </Field>
        <Field label="Standaard aantal plekken per dienst">
          <input type="number" min={1} max={20} className={inpSmall} value={form.default_max_students}
            onChange={e => set('default_max_students', Number(e.target.value))} />
        </Field>
        <Field label="Dagen met maximaal 1 plek" hint="Bijv. zaterdag: wie het eerst komt.">
          <DayPicker selected={form.single_staff_weekdays} onToggle={d => toggleDay('single_staff_weekdays', d)} />
        </Field>
        <Field label="Maandlimiet-factor" hint="Max. uren per maand = contractmaximum × deze factor (server-side afgedwongen).">
          <input type="number" min={1} max={10} step="0.5" className={inpSmall} value={form.monthly_cap_factor}
            onChange={e => set('monthly_cap_factor', Number(e.target.value))} />
        </Field>
      </Section>

      {/* Loonregels */}
      <Section title="Loonregels" desc="Gebruikt in de urenexport, Inzichten en het financieel dashboard.">
        <Field label="Toeslagdagen" hint="Uren op deze dagen worden apart geteld (bijv. voor weekendtoeslag).">
          <DayPicker selected={form.premium_weekdays} onToggle={d => toggleDay('premium_weekdays', d)} />
        </Field>
        <Field label="Naam van de toeslagdagen" hint='Verschijnt in de export-kolommen, bijv. "zaterdag" of "weekend".'>
          <input className={inp} value={form.premium_label} onChange={e => set('premium_label', e.target.value)} />
        </Field>
        <Field label="Onbetaalde pauze">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-dark">
              <input type="checkbox" checked={form.pause_enabled} onChange={e => set('pause_enabled', e.target.checked)} />
              Aftrekken bij hele dagen
            </label>
            <input type="time" className={inpSmall} value={form.pause_start} disabled={!form.pause_enabled}
              onChange={e => set('pause_start', e.target.value)} />
            <span className="text-xs text-gray-400">tot</span>
            <input type="time" className={inpSmall} value={form.pause_end} disabled={!form.pause_enabled}
              onChange={e => set('pause_end', e.target.value)} />
          </div>
        </Field>
      </Section>

      {/* Diensttijden */}
      <Section title="Diensttijden" desc="Standaardtijden per dagdeel en de vroeg/laat-varianten voor de tijdverdeling.">
        {form.shift_types.map((t, i) => (
          <div key={t.key} className="rounded-xl border border-gray-100 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inp} font-semibold max-w-[160px]`} value={t.label}
                onChange={e => setShiftType(i, { label: e.target.value })} />
              <span className="text-xs text-gray-400">standaard</span>
              <input type="time" className={inpSmall} value={t.start} onChange={e => setShiftType(i, { start: e.target.value })} />
              <span className="text-xs text-gray-400">tot</span>
              <input type="time" className={inpSmall} value={t.end} onChange={e => setShiftType(i, { end: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <span className="w-14 font-semibold">Vroeg</span>
              <input type="time" className={inpSmall} value={t.early.start} onChange={e => setShiftPreset(i, 'early', 'start', e.target.value)} />
              <span>tot</span>
              <input type="time" className={inpSmall} value={t.early.end} onChange={e => setShiftPreset(i, 'early', 'end', e.target.value)} />
              <span className="w-14 font-semibold ml-4">Laat</span>
              <input type="time" className={inpSmall} value={t.late.start} onChange={e => setShiftPreset(i, 'late', 'start', e.target.value)} />
              <span>tot</span>
              <input type="time" className={inpSmall} value={t.late.end} onChange={e => setShiftPreset(i, 'late', 'end', e.target.value)} />
            </div>
          </div>
        ))}
        <p className="text-[11px] text-gray-400">
          Nieuwe tijden gelden voor diensten die je hierna aanmaakt; bestaande diensten behouden hun eigen tijden
          (die pas je aan via Roosterbeheer).
        </p>
      </Section>

      <button
        onClick={save}
        disabled={saving}
        className="text-sm font-semibold text-white px-5 py-2.5 rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {saving ? 'Opslaan...' : saved ? '✓ Opgeslagen' : 'Alles opslaan'}
      </button>
    </div>
  )
}

const inp = 'flex-1 min-w-0 border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm text-dark focus:outline-none focus:border-gray-400'
const inpSmall = 'border border-gray-200 bg-white rounded-xl px-2.5 py-2 text-sm text-dark w-24 focus:outline-none focus:border-gray-400 disabled:opacity-40'

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="font-bold text-dark text-sm">{title}</h2>
      <p className="text-xs text-gray-400 mt-0.5 mb-4">{desc}</p>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function DayPicker({ selected, onToggle }: { selected: number[]; onToggle: (day: number) => void }) {
  return (
    <div className="flex gap-1.5">
      {WEEKDAYS.map(d => (
        <button
          key={d.value}
          type="button"
          onClick={() => onToggle(d.value)}
          className={`w-10 py-2 rounded-lg text-xs font-semibold border transition-colors ${
            selected.includes(d.value)
              ? 'text-white border-transparent'
              : 'border-gray-200 text-gray-400 hover:text-dark hover:border-gray-300'
          }`}
          style={selected.includes(d.value) ? { backgroundColor: 'var(--color-dark)' } : {}}
        >
          {d.label}
        </button>
      ))}
    </div>
  )
}
