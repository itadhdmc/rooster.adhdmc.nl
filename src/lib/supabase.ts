import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase omgevingsvariabelen ontbreken. Kopieer .env.example naar .env en vul in.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_DOMAIN || 'adhdmc.nl'
