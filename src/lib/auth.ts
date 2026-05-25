import { supabase, ALLOWED_DOMAIN } from './supabase'

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      scopes: 'openid email profile https://www.googleapis.com/auth/calendar.events',
      queryParams: {
        hd: ALLOWED_DOMAIN,
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export function isAllowedEmail(email: string): boolean {
  return email.endsWith(`@${ALLOWED_DOMAIN}`)
}

export async function getGoogleToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.provider_token ?? null
}
