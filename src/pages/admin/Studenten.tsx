import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Profile } from '../../types'

export default function Studenten() {
  const [students, setStudents] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<Profile>>({})

  useEffect(() => { loadStudents() }, [])

  async function loadStudents() {
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setStudents(data || [])
    setLoading(false)
  }

  async function saveEdit(id: string) {
    await supabase.from('profiles').update(editData).eq('id', id)
    setEditing(null)
    setEditData({})
    await loadStudents()
  }

  async function toggleActive(student: Profile) {
    await supabase.from('profiles').update({ active: !student.active }).eq('id', student.id)
    await loadStudents()
  }

  async function setAdmin(student: Profile) {
    if (!confirm(`Weet je zeker dat je ${student.full_name || student.email} admin wil maken?`)) return
    await supabase.from('profiles').update({ role: 'admin' }).eq('id', student.id)
    await loadStudents()
  }

  if (loading) return <Spinner />

  const admins = students.filter(s => s.role === 'admin')
  const activeStudents = students.filter(s => s.role === 'student' && s.active)
  const inactiveStudents = students.filter(s => s.role === 'student' && !s.active)

  const rowProps = { editing, onEdit: (s: Profile) => { setEditing(s.id); setEditData({ full_name: s.full_name, contract_min_hours: s.contract_min_hours, contract_max_hours: s.contract_max_hours }) }, onSave: saveEdit, editData, setEditData, onToggle: toggleActive, onSetAdmin: setAdmin }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark">Studenten</h1>
        <p className="text-gray-400 text-sm mt-0.5">Beheer rollen en contracturen</p>
      </div>

      <Section title={`Admins (${admins.length})`}>
        {admins.map(s => <StudentRow key={s.id} student={s} {...rowProps} />)}
      </Section>

      <Section title={`Actieve studenten (${activeStudents.length})`}>
        {activeStudents.length === 0
          ? <p className="text-sm text-gray-400 py-6 text-center">Geen actieve studenten.</p>
          : activeStudents.map(s => <StudentRow key={s.id} student={s} {...rowProps} />)}
      </Section>

      {inactiveStudents.length > 0 && (
        <Section title={`Inactief (${inactiveStudents.length})`}>
          {inactiveStudents.map(s => <StudentRow key={s.id} student={s} {...rowProps} />)}
        </Section>
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
  student, editing, onEdit, onSave, editData, setEditData, onToggle, onSetAdmin,
}: {
  student: Profile
  editing: string | null
  onEdit: (s: Profile) => void
  onSave: (id: string) => void
  editData: Partial<Profile>
  setEditData: (d: Partial<Profile>) => void
  onToggle: (s: Profile) => void
  onSetAdmin: (s: Profile) => void
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
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-gray-400">Min</span>
            <input type="number" min={0} max={40} className="border border-gray-200 rounded-xl px-2 py-2 text-sm w-16 focus:outline-none focus:border-salmon-400"
              value={editData.contract_min_hours} onChange={e => setEditData({ ...editData, contract_min_hours: Number(e.target.value) })} />
            <span className="text-xs text-gray-400">Max</span>
            <input type="number" min={0} max={40} className="border border-gray-200 rounded-xl px-2 py-2 text-sm w-16 focus:outline-none focus:border-salmon-400"
              value={editData.contract_max_hours} onChange={e => setEditData({ ...editData, contract_max_hours: Number(e.target.value) })} />
            <span className="text-xs text-gray-400">u/week</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onSave(student.id)} className="text-xs text-white px-3 py-2 rounded-xl font-semibold" style={{ backgroundColor: '#f87369' }}>
              Opslaan
            </button>
            <button onClick={() => setEditData({})} className="text-xs bg-gray-100 text-gray-600 px-3 py-2 rounded-xl hover:bg-gray-200 font-medium">
              Annuleer
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ backgroundColor: student.role === 'admin' ? '#f87369' : '#3c3c3b' }}
            >
              {(student.full_name || student.email)[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-dark">
                {student.full_name || <span className="text-gray-400 font-normal">Geen naam</span>}
              </p>
              <p className="text-xs text-gray-400">{student.email}</p>
            </div>
            {!student.active && (
              <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inactief</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 hidden sm:block">
              {student.contract_min_hours}–{student.contract_max_hours}u/w
            </span>
            <button onClick={() => onEdit(student)} className="text-xs font-semibold" style={{ color: '#f87369' }}>
              Bewerken
            </button>
            <button onClick={() => onToggle(student)} className="text-xs text-gray-400 hover:text-dark transition-colors">
              {student.active ? 'Deactiveer' : 'Activeer'}
            </button>
            {student.role === 'student' && (
              <button onClick={() => onSetAdmin(student)} className="text-xs text-amber-600 hover:text-amber-700 hidden sm:block font-medium">
                Admin
              </button>
            )}
          </div>
        </div>
      )}
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
