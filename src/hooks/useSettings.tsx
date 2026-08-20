import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hoursBetween } from '../utils/shiftTimes'
import { PauseConfig } from '../utils/paidHours'

export interface ShiftTypeConfig {
  key: string
  label: string
  start: string
  end: string
  early: { start: string; end: string }
  late: { start: string; end: string }
}

export interface AppSettings {
  org_name: string
  portal_url: string
  allowed_domain: string
  support_email: string
  mail_from_name: string
  mail_from_email: string
  calendar_label: string
  color_primary: string
  color_dark: string
  monthly_cap_factor: number
  pause_enabled: boolean
  pause_start: string
  pause_end: string
  premium_weekdays: number[]
  premium_label: string
  single_staff_weekdays: number[]
  roster_weekdays: number[]
  default_max_students: number
  // Capaciteit (plekken per dienst) per weekdag, ma (index 0) t/m zo.
  day_capacities: number[]
  shift_types: ShiftTypeConfig[]
}

// De ADHDMC-waarden als fallback, o.a. zolang migratie 0022 nog niet
// is uitgevoerd — gedrag blijft dan exact zoals voorheen.
export const DEFAULT_SETTINGS: AppSettings = {
  org_name: 'ADHDMC',
  portal_url: 'https://rooster.adhdmc.nl',
  allowed_domain: 'adhdmc.nl',
  support_email: 'ictservicedesk@adhdmc.nl',
  mail_from_name: 'ADHDMC Rooster',
  mail_from_email: 'rooster@adhdmc.nl',
  calendar_label: 'ADHDMC Zorgadministratie',
  // Echte hexwaarden (geen var()): dit zijn de bronkleuren waaruit de
  // CSS-variabelen en tinten worden berekend.
  color_primary: '#f87369',
  color_dark: '#3c3c3b',
  monthly_cap_factor: 4,
  pause_enabled: true,
  pause_start: '12:00',
  pause_end: '12:30',
  premium_weekdays: [6],
  premium_label: 'zaterdag',
  single_staff_weekdays: [3, 6],
  roster_weekdays: [1, 2, 3, 4, 5, 6],
  default_max_students: 2,
  day_capacities: [2, 2, 1, 2, 2, 1, 2],
  shift_types: [
    { key: 'ochtend', label: 'Ochtend', start: '08:30', end: '12:30', early: { start: '08:00', end: '12:00' }, late: { start: '08:30', end: '12:30' } },
    { key: 'middag', label: 'Middag', start: '12:00', end: '17:30', early: { start: '12:00', end: '17:00' }, late: { start: '12:30', end: '17:30' } },
  ],
}

interface SettingsContextValue {
  settings: AppSettings
  loaded: boolean
  reload: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  reload: async () => {},
})

// Mengt een hexkleur met wit (tint) of zwart (shade); weight = aandeel kleur.
function mix(hex: string, withColor: 'white' | 'black', weight: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const target = withColor === 'white' ? 255 : 0
  const channels = [0, 2, 4].map(i => {
    const c = parseInt(clean.slice(i, i + 2), 16)
    return Math.round(c * weight + target * (1 - weight)).toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}

// Zet het volledige kleurenpalet als CSS-variabelen; alle tailwind-
// klassen (salmon-*/dark-*) en inline var()-styles volgen automatisch.
function applyThemeColors(primary: string, dark: string) {
  const root = document.documentElement.style
  root.setProperty('--color-primary-50', mix(primary, 'white', 0.08))
  root.setProperty('--color-primary-100', mix(primary, 'white', 0.16))
  root.setProperty('--color-primary-200', mix(primary, 'white', 0.35))
  root.setProperty('--color-primary-300', mix(primary, 'white', 0.55))
  root.setProperty('--color-primary-400', mix(primary, 'white', 0.8))
  root.setProperty('--color-primary', primary)
  root.setProperty('--color-primary-600', mix(primary, 'black', 0.88))
  root.setProperty('--color-primary-700', mix(primary, 'black', 0.75))
  root.setProperty('--color-dark', dark)
  root.setProperty('--color-dark-800', mix(dark, 'black', 0.9))
  root.setProperty('--color-dark-900', mix(dark, 'black', 0.78))
}

function normalize(row: Record<string, unknown>): AppSettings {
  const s = { ...DEFAULT_SETTINGS, ...row } as AppSettings
  // time-kolommen komen als 'HH:MM:SS' terug; wij rekenen met 'HH:MM'.
  s.pause_start = String(s.pause_start).slice(0, 5)
  s.pause_end = String(s.pause_end).slice(0, 5)
  return s
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  async function reload() {
    const { data } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle()
    const s = data ? normalize(data) : DEFAULT_SETTINGS
    setSettings(s)
    applyThemeColors(s.color_primary, s.color_dark)
    setLoaded(true)
  }

  useEffect(() => { reload() }, [])

  return (
    <SettingsContext.Provider value={{ settings, loaded, reload }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}

// ------------------------------------------------------------
// Afgeleide helpers (puur, settings gaan er expliciet in)
// ------------------------------------------------------------

// ISO-weekdag 1 (ma) t/m 7 (zo).
export function isoWeekday(d: Date): number {
  const n = d.getDay()
  return n === 0 ? 7 : n
}

export function pauseConfig(s: AppSettings): PauseConfig {
  return {
    enabled: s.pause_enabled,
    start: s.pause_start,
    end: s.pause_end,
    hours: hoursBetween(s.pause_start, s.pause_end),
  }
}

export function isPremiumDate(s: AppSettings, iso: string): boolean {
  return s.premium_weekdays.includes(isoWeekday(new Date(iso + 'T00:00:00')))
}

export function isSingleStaffDate(s: AppSettings, d: Date): boolean {
  return s.single_staff_weekdays.includes(isoWeekday(d))
}

export function maxStudentsFor(s: AppSettings, d: Date): number {
  const cap = s.day_capacities?.[isoWeekday(d) - 1]
  if (typeof cap === 'number' && cap > 0) return cap
  // Fallback op het oude model (zolang migratie 0024 nog niet draait).
  return isSingleStaffDate(s, d) ? 1 : s.default_max_students
}

// Publieke tint-helper voor previews (zelfde mixlogica als het thema).
export function tint(hex: string, withColor: 'white' | 'black', weight: number): string {
  return mix(hex, withColor, weight)
}

export function shiftTypeConfig(s: AppSettings, key: string): ShiftTypeConfig {
  return s.shift_types.find(t => t.key === key)
    ?? DEFAULT_SETTINGS.shift_types.find(t => t.key === key)
    ?? s.shift_types[0]
}
