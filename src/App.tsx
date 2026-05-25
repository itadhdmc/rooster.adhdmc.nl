import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import Beschikbaarheid from './pages/Beschikbaarheid'
import MijnRooster from './pages/MijnRooster'
import Ruilverzoeken from './pages/Ruilverzoeken'
import AdminDashboard from './pages/admin/AdminDashboard'
import NieuwePeriode from './pages/admin/NieuwePeriode'
import RoosterBeheer from './pages/admin/RoosterBeheer'
import Studenten from './pages/admin/Studenten'
import BeschikbaarheidOverzicht from './pages/admin/BeschikbaarheidOverzicht'

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { session, loading, isAdmin } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!session) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />
  return <Layout>{children}</Layout>
}

function AppRoutes() {
  const { session, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/beschikbaarheid" element={<ProtectedRoute><Beschikbaarheid /></ProtectedRoute>} />
      <Route path="/mijn-rooster" element={<ProtectedRoute><MijnRooster /></ProtectedRoute>} />
      <Route path="/ruilverzoeken" element={<ProtectedRoute><Ruilverzoeken /></ProtectedRoute>} />

      <Route path="/admin" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/periodes/nieuw" element={<ProtectedRoute adminOnly><NieuwePeriode /></ProtectedRoute>} />
      <Route path="/admin/rooster/:periodId" element={<ProtectedRoute adminOnly><RoosterBeheer /></ProtectedRoute>} />
      <Route path="/admin/studenten" element={<ProtectedRoute adminOnly><Studenten /></ProtectedRoute>} />
      <Route path="/admin/beschikbaarheid" element={<ProtectedRoute adminOnly><BeschikbaarheidOverzicht /></ProtectedRoute>} />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
