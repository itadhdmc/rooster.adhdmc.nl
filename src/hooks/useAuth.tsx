import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase, ALLOWED_DOMAIN } from '../lib/supabase'
import { Profile } from '../types'

interface AuthContextType {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId: string, retries = 5) {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 600 * attempt))
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (data) {
        setProfile(data)
        setLoading(false)
        return
      }
    }
    // Profile still missing after retries — create it from session
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const u = session.user
      await supabase.from('profiles').upsert({
        id: u.id,
        email: u.email!,
        full_name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null,
      }, { onConflict: 'id' })
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      setProfile(data)
    }
    setLoading(false)
  }

  const isAllowedDomain = session?.user?.email?.endsWith(`@${ALLOWED_DOMAIN}`) ?? false

  return (
    <AuthContext.Provider value={{
      session: isAllowedDomain ? session : null,
      user: isAllowedDomain ? session?.user ?? null : null,
      profile,
      loading,
      isAdmin: profile?.role === 'admin',
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
