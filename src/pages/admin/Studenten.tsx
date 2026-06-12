import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Profile } from '../../types'
import { ALLOWED_DOMAIN } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

interface PendingStudent {
  id: string
  email: string
  full_name: string
  created_at: string
}

export default function Studenten() {
  const { profile: me } = useAuth()
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
    const { error } = await supabase.from('profiles').update(editData).eq('id', id)
    if (error) alert('Opslaan mislukt: ' + error.message)
    setEditing(null)
    setEditData({})
    await loadAll()
  }

  async function toggleActive(student: Profile) {
    const { error } = await supabase.from('profiles').update({ active: !student.active }).eq('id', student.id)
    if (error) alert('Status wijzigen mislukt: ' + error.message)
    await loadAll()
  }

  async function setRole(student: Profile, role: 'admin' | 'student') {
    const name = student.full_name || student.email
    const vraag = role === 'admin'
      ? `Weet je zeker dat je ${name} admin wil maken? Admins kunnen het hele rooster en alle medewerkers beheren.`
      : `Weet je zeker dat je de admin-rol van ${name} wil afnemen?`
    if (!confirm(vraag)) return
    const { error } = await supabase.from('profiles').update({ role }).eq('id', student.id)
    if (error) alert('Rol wijzigen mislukt: ' + error.message)
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
    const { error } = await supabase.from('profiles').delete().eq('id', deleteConfirm.id)
    if (error) alert('Verwijderen mislukt: ' + error.message)
    setDeleteConfirm(null)
    setDeleting(false)
    await loadAll()
  }

  if (loading) return <Spinner />

  const admins = students.filter(s => s.role === 'admin')
  const activeStudents = students.filter(s => s.role === 'student' && s.active)
  const inactiveStudents = students.filter(s => s.role === 'student' && !s.active)

  const sharedRowProps = { editing, myId: me?.id, onEdit: (s: Profile) => {
    setEditing(s.id)
    setEditData({ full_name: s.full_name, contract_min_hours: s.contract_min_hours, contract_max_hours: s.contract_max_hours })
  }, onSave: saveEdit, onCancel: () => { setEditing(null); setEditData({}) },
    editData, setEditData, onToggle: toggleActive, onSetRole: setRole,
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
                  <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-medium">
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
        <Modal title="Medewerker verwijderen" onClose={() => setDeleteConfirm(null)}>
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
  student, myId, editing, onEdit, onSave, onCancel, editData, setEditData, onToggle, onSetRole, onDelete,
}: {
  student: Profile
  myId?: string
  editing: string | null
  onEdit: (s: Profile) => void
  onSave: (id: string) => void
  onCancel: () => void
  editData: Partial<Profile>
  setEditData: (d: Partial<Profile>) => void
  onToggle: (s: Profile) => void
  onSetRole: (s: Profile, role: 'admin' | 'student') => void
  onDelete: (id: string, name: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const isEditing = editing === student.id
  const isAdminRow = student.role === 'admin'
  // Acties op je eigen account verbergen we: jezelf deactiveren,
  // degraderen of verwijderen sluit je buiten.
  const isSelf = student.id === myId

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(student.email)
      setCopied(true)
      setTimeout(() => { setCopied(false); setMenuOpen(false) }, 900)
    } catch {
      setMenuOpen(false)
    }
  }

  return (
    <div className="px-5 py-4">
      {isEditing ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1 min-w-32 focus:outline-none focus:border-salmon-400"
            value={editData.full_name || ''}
            onChange={e => setEditData({ ...editData, full_name: e.target.value })}
            placeholder="Naam"
            autoFocus
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
              className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition-colors shadow-sm">
              <CheckMiniIcon className="w-3.5 h-3.5" />
              Opslaan
            </button>
            <button onClick={onCancel}
              className="text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-400 hover:text-dark transition-colors">
              Annuleer
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ backgroundColor: isAdminRow ? '#f87369' : '#3c3c3b' }}
            >
              {(student.full_name || student.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-dark truncate">
                {student.full_name || <span className="text-gray-400 font-normal">Geen naam</span>}
                {isSelf && <span className="ml-1.5 text-[10px] font-bold text-gray-300 uppercase">(jij)</span>}
              </p>
              <p className="text-xs text-gray-400 truncate">{student.email}</p>
            </div>
            {!student.active && (
              <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full flex-shrink-0">Inactief</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full hidden sm:block">
              {student.contract_min_hours}–{student.contract_max_hours}u/w
            </span>
            <button
              onClick={() => onEdit(student)}
              title="Naam en contracturen bewerken"
              className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-dark hover:border-gray-300 transition-colors"
            >
              <PencilIcon className="w-3.5 h-3.5" />
            </button>

            {/* Meer acties */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                title="Meer acties"
                className={`p-2 rounded-lg border transition-colors ${
                  menuOpen
                    ? 'border-gray-300 bg-gray-50 text-dark'
                    : 'border-gray-200 text-gray-400 hover:text-dark hover:border-gray-300'
                }`}
              >
                <DotsIcon className="w-3.5 h-3.5" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-gray-100 rounded-xl shadow-xl z-20 py-1.5">
                    <MenuItem
                      icon={<MailIcon />}
                      label={copied ? 'E-mail gekopieerd ✓' : 'E-mailadres kopiëren'}
                      onClick={copyEmail}
                    />
                    {!isSelf && (
                      <MenuItem
                        icon={<PowerIcon />}
                        label={student.active ? 'Deactiveren (geen toegang)' : 'Weer activeren'}
                        onClick={() => { setMenuOpen(false); onToggle(student) }}
                      />
                    )}
                    {!isSelf && (
                      <MenuItem
                        icon={<ShieldIcon />}
                        label={isAdminRow ? 'Admin-rol afnemen' : 'Admin maken'}
                        onClick={() => { setMenuOpen(false); onSetRole(student, isAdminRow ? 'student' : 'admin') }}
                      />
                    )}
                    {!isSelf && (
                      <>
                        <div className="my-1.5 border-t border-gray-100" />
                        <MenuItem
                          danger
                          icon={<TrashIcon />}
                          label="Verwijderen…"
                          onClick={() => { setMenuOpen(false); onDelete(student.id, student.full_name || student.email) }}
                        />
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium transition-colors ${
        danger ? 'text-rose-500 hover:bg-rose-50' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      <span className="w-4 h-4 flex-shrink-0 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
      {label}
    </button>
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

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897l12.682-12.68Z" />
    </svg>
  )
}

function DotsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  )
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
    </svg>
  )
}

function PowerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9" />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  )
}

function CheckMiniIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}
