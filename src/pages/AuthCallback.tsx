import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const error = params.get('error')

    if (error) {
      console.error('OAuth error:', error, params.get('error_description'))
      navigate('/login', { replace: true })
      return
    }

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (error || !data.session) {
          console.error('Session exchange failed:', error)
          navigate('/login', { replace: true })
        } else {
          navigate('/dashboard', { replace: true })
        }
      })
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) navigate('/dashboard', { replace: true })
        else navigate('/login', { replace: true })
      })
    }
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-50">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-600">Inloggen...</p>
      </div>
    </div>
  )
}
