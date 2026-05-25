import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Profile } from '../../types'
import { ALLOWED_DOMAIN } from '../../lib/supabase'

interface PendingStudent {
  id: string
  email: string
  full_name: string
  created_at: string
}

export default function Studenten() {
  const [students, setStudents] = useState<Profile[]>([])
  const [pending, setPending] = useState<PendingStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<Profile>>({})
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('pending_students').select('*').order('created_at'),
    ])
    setStudents(s || [])
    setPending(p || [])
    setLoading(false)
  }

  async function saveEdit(id: string) {
    await supabase.from('profiles').update(editData).eq('id', id)
    setEditing(null)
    setEditData({})
    await loadAll()
  }

  async function toggleActive(student: Profile) {
    await supabase.from('profiles').update({ active: !student.active }).eq('id', student.id)
    await loadAll()
  }

  async function setAdmin(student: Profile) {
    if (!confirm(`Weet je zeker dat je ${student.full_name || student.email} admin wil maken?`)) return
    await supabase.from('profiles').update({ role: 'admin' }).eq('id', student.id)
    await loadAll()
  }

  async function handleInvite() {
    setInviteError('')
    const email = inviteEmail.trim().toLowerCase()
    const name = inviteName.trim()

    if (!name) { setInviteError('Voer een naam in.'); return }
    if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setInviteError(`Gebruik een @${ALLOWED_DOMAIN} e-mailadres.`)
      return
    }

    // Check if already exists as active profile
    const existing = students.find(s => s.email.toLowerCase() === email)
    if (existing) {
      setInviteError('Er bestaat al een account met dit e-mailadres.')
      return
    }

    setInviting(true)
    const { error } = await supabase.from('pending_students').insert({
      email,
      full_name: name,
    })

    if (error) {
      setInviteError(error.code === '23505'
        ? 'Er is al een uitnodiging voor dit e-mailadres.'
        : 'Fout: ' + error.message)
    } else {
      setInviteName('')
      setInviteEmail('')
      setShowInviteModal(false)
      await loadAll()
    }
    setInviting(false)
  }

  async function cancelInvite(pendingId: string) {
    await supabase.from('pending_students').delete().eq('id', pendingId)
    await loadAll()
  }

  async function handleDelete() {
    if (!deleteConfirm) return
    setDeleting(true)
    await supabase.from('profiles').delete().eq('id', deleteConfirm.id)
    setDeleteConfirm(null)
    setDeleting(false)
    await loadAll()
  }

  if (loading) return <Spinner />

  const admins = students.filter(s => s.role === 'admin')
  const activeStudents = students.filter(s => s.role === 'student' && s.active)
  const inactiveStudents = students.filter(s => s.role === 'student' && !s.active)

  const sharedRowProps = { editing, onEdit: (s: Profile) => {
    setEditing(s.id)
    setEditData({ full_name: s.full_name, contract_min_hours: s.contract_min_hours, contract_max_hours: s.contract_max_hours })
  }, onSave: saveEdit, editData, setEditData, onToggle: toggleActive, onSetAdmin: setAdmin,
    onDelete: (id: string, name: string) => setDeleteConfirm({ id, name }) }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark">Studenten</h1>
          <p className="text-gray-400 text-sm mt-0.5">Beheer rollen, contracturen en toegang</p>
        </div>
        <button
          onClick={() => { setShowInviteModal(true); setInviteError('') }}
          className="btn-primary text-sm"
        >
          + Uitnodigen
        </button>
      </div>

      {/* Pending invites */}
      {pending.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
            Uitgenodigd — wacht op eerste login ({pending.length})
          </p>
          <div className="card divide-y divide-gray-50">
            {pending.map(p => (
              <div key={p.id} className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold bg-gray-100 text-gray-400 flex-shrink-0">
                    {p.full_name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-dark">{p.full_name}</p>
                    <p className="text-xs text-gray-400">{p.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-semibold">
                    Wacht op login
                  </span>
                  <button
                    onClick={() => cancelInvite(p.id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors font-medium"
                  >
                    Annuleer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Section title={`Admins (${admins.length})`}>
        {admins.map(s => <StudentRow key={s.id} student={s} {...sharedRowProps} />)}
      </Section>

      <Section title={`Actieve studenten (${activeStudents.length})`}>
        {activeStudents.length === 0
          ? <p className="text-sm text-gray-400 py-6 text-center px-5">Geen actieve studenten. Studenten verschijnen hier na hun eerste login.</p>
          : activeStudents.map(s => <StudentRow key={s.id} student={s} {...sharedRowProps} />)}
      </Section>

      {inactiveStudents.length > 0 && (
        <Section title={`Inactief (${inactiveStudents.length})`}>
          {inactiveStudents.map(s => <StudentRow key={s.id} student={s} {...sharedRowProps} />)}
        </Section>
      )}

      {/* Invite modal */}
      {showInviteModal && (
        <Modal title="Student uitnodigen" onClose={() => setShowInviteModal(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Voeg een student toe zodat ze al in het systeem staan vóór hun eerste login.
              Zodra ze inloggen met hun @{ALLOWED_DOMAIN} account worden ze automatisch gekoppeld.
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">Naam</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-salmon-400"
                placeholder="Voornaam Achternaam"
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">E-mailadres</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-salmon-400"
                placeholder={`naam@${ALLOWED_DOMAIN}`}
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
              />
            </div>

            {inviteError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{inviteError}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleInvite}
                disabled={inviting}
                className="btn-primary flex-1"
              >
                {inviting ? 'Toevoegen...' : 'Toevoegen'}
              </button>
              <button
                onClick={() => setShowInviteModal(false)}
                className="btn-ghost flex-1"
              >
                Annuleer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <Modal title="Student verwijderen" onClose={() => setDeleteConfirm(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Weet je zeker dat je <strong>{deleteConfirm.name}</strong> wilt verwijderen?
              Alle beschikbaarheid en inroosteringen worden ook verwijderd. Dit is niet ongedaan te maken.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: '#ef4444' }}
              >
                {deleting ? 'Verwijderen...' : 'Ja, verwijderen'}
              </button>
              <button onClick={() => setDeleteConfirm(null)} className="btn-ghost flex-1">
                Annuleer
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{title}</p>
      <div className="card divide-y divide-gray-50">{children}</div>
    </div>
  )
}

function StudentRow({
  student, editing, onEdit, onSave, editData, setEditData, onToggle, onSetAdmin, onDelete,
}: {
  student: Profile
  editing: string | null
  onEdit: (s: Profile) => void
  onSave: (id: string) => void
  editData: Partial<Profile>
  setEditData: (d: Partial<Profile>) => void
  onToggle: (s: Profile) => void
  onSetAdmin: (s: Profile) => void
  onDelete: (id: string, name: string) => void
}) {
  const isEditing = editing === student.id

  return (
    <div className="px-5 py-4">
      {isEditing ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1 min-w-32 focus:outline-none focus:border-salmon-400"
            value={editData.full_name || ''}
            onChange={e => setEditData({ ...editData, full_name: e.target.value })}
            placeholder="Naam"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Min</span>
            <input type="number" min={0} max={40}
              className="border border-gray-200 rounded-xl px-2 py-2 text-sm w-16 focus:outline-none focus:border-salmon-400"
              value={editData.contract_min_hours}
              onChange={e => setEditData({ ...editData, contract_min_hours: Number(e.target.value) })} />
            <span className="text-xs text-gray-400">Max</span>
            <input type="number" min={0} max={40}
              className="border border-gray-200 rounded-xl px-2 py-2 text-sm w-16 focus:outline-none focus:border-salmon-400"
              value={editData.contract_max_hours}
              onChange={e => setEditData({ ...editData, contract_max_hours: Number(e.target.value) })} />
            <span className="text-xs text-gray-400">u/w</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onSave(student.id)}
              className="text-xs text-white px-3 py-2 rounded-xl font-semibold"
              style={{ backgroundColor: '#f87369' }}>
              Opslaan
            </button>
            <button onClick={() => setEditData({})}
              className="text-xs bg-gray-100 text-gray-600 px-3 py-2 rounded-xl hover:bg-gray-200">
              Annuleer
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ backgroundColor: student.role === 'admin' ? '#f87369' : '#3c3c3b' }}
            >
              {(student.full_name || student.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-dark truncate">
                {student.full_name || <span className="text-gray-400 font-normal">Geen naam</span>}
              </p>
              <p className="text-xs text-gray-400 truncate">{student.email}</p>
            </div>
            {!student.active && (
              <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full flex-shrink-0">Inactief</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-400 hidden sm:block">
              {student.contract_min_hours}–{student.contract_max_hours}u/w
            </span>
            <button onClick={() => onEdit(student)}
              className="text-xs font-semibold" style={{ color: '#f87369' }}>
              Bewerken
            </button>
            <button onClick={() => onToggle(student)}
              className="text-xs text-gray-400 hover:text-dark transition-colors">
              {student.active ? 'Deactiveer' : 'Activeer'}
            </button>
            {student.role === 'student' && (
              <button
                onClick={() => onDelete(student.id, student.full_name || student.email)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors hidden sm:block"
              >
                Verwijder
              </button>
            )}
            {student.role === 'student' && (
              <button onClick={() => onSetAdmin(student)}
                className="text-xs text-amber-500 hover:text-amber-700 hidden lg:block">
                Admin
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-dark text-lg">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-dark text-xl leading-none transition-colors">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#f87369', borderTopColor: 'transparent' }} />
    </div>
  )
}
