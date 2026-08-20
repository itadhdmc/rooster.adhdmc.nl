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
    document.documentElement.style.setProperty('--color-primary', s.color_primary)
    document.documentElement.style.setProperty('--color-dark', s.color_dark)
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
  return isSingleStaffDate(s, d) ? 1 : s.default_max_students
}

export function shiftTypeConfig(s: AppSettings, key: string): ShiftTypeConfig {
  return s.shift_types.find(t => t.key === key)
    ?? DEFAULT_SETTINGS.shift_types.find(t => t.key === key)
    ?? s.shift_types[0]
}
