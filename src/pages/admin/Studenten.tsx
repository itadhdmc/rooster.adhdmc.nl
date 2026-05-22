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
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name')
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Studenten beheren</h1>

      <Section title={`Admins (${admins.length})`}>
        {admins.map(s => <StudentRow key={s.id} student={s} onToggle={toggleActive} isEditing={editing === s.id}
          onEdit={() => { setEditing(s.id); setEditData({ full_name: s.full_name, contract_min_hours: s.contract_min_hours, contract_max_hours: s.contract_max_hours }) }}
          onSave={() => saveEdit(s.id)} editData={editData} setEditData={setEditData} onSetAdmin={setAdmin} />)}
      </Section>

      <Section title={`Actieve studenten (${activeStudents.length})`}>
        {activeStudents.length === 0
          ? <p className="text-sm text-gray-500 py-4 text-center">Geen actieve studenten.</p>
          : activeStudents.map(s => <StudentRow key={s.id} student={s} onToggle={toggleActive} isEditing={editing === s.id}
              onEdit={() => { setEditing(s.id); setEditData({ full_name: s.full_name, contract_min_hours: s.contract_min_hours, contract_max_hours: s.contract_max_hours }) }}
              onSave={() => saveEdit(s.id)} editData={editData} setEditData={setEditData} onSetAdmin={setAdmin} />)
        }
      </Section>

      {inactiveStudents.length > 0 && (
        <Section title={`Inactief (${inactiveStudents.length})`}>
          {inactiveStudents.map(s => <StudentRow key={s.id} student={s} onToggle={toggleActive} isEditing={editing === s.id}
            onEdit={() => { setEditing(s.id); setEditData({ full_name: s.full_name, contract_min_hours: s.contract_min_hours, contract_max_hours: s.contract_max_hours }) }}
            onSave={() => saveEdit(s.id)} editData={editData} setEditData={setEditData} onSetAdmin={setAdmin} />)}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-semibold text-gray-700 mb-2 text-sm uppercase tracking-wide">{title}</h2>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {children}
      </div>
    </div>
  )
}

function StudentRow({
  student, onToggle, isEditing, onEdit, onSave, editData, setEditData, onSetAdmin
}: {
  student: Profile
  onToggle: (s: Profile) => void
  isEditing: boolean
  onEdit: () => void
  onSave: () => void
  editData: Partial<Profile>
  setEditData: (d: Partial<Profile>) => void
  onSetAdmin: (s: Profile) => void
}) {
  return (
    <div className="px-4 py-3">
      {isEditing ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-32"
            value={editData.full_name || ''}
            onChange={e => setEditData({ ...editData, full_name: e.target.value })}
            placeholder="Naam"
          />
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-500 text-xs">Min:</label>
            <input type="number" min={0} max={40} className="border border-gray-200 rounded px-2 py-1 text-sm w-16"
              value={editData.contract_min_hours} onChange={e => setEditData({ ...editData, contract_min_hours: Number(e.target.value) })} />
            <label className="text-gray-500 text-xs">Max:</label>
            <input type="number" min={0} max={40} className="border border-gray-200 rounded px-2 py-1 text-sm w-16"
              value={editData.contract_max_hours} onChange={e => setEditData({ ...editData, contract_max_hours: Number(e.target.value) })} />
            <span className="text-gray-400 text-xs">uur/week</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onSave} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">Opslaan</button>
            <button onClick={() => setEditData({})} className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200">Annuleer</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              student.role === 'admin' ? 'bg-yellow-200 text-yellow-800' : 'bg-blue-100 text-blue-700'
            }`}>
              {(student.full_name || student.email)[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{student.full_name || <span className="text-gray-400">Geen naam</span>}</p>
              <p className="text-xs text-gray-500">{student.email}</p>
            </div>
            {!student.active && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactief</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 hidden sm:block">
              {student.contract_min_hours}–{student.contract_max_hours}u/week
            </span>
            <button onClick={onEdit} className="text-xs text-blue-600 hover:underline">Bewerken</button>
            <button onClick={() => onToggle(student)} className="text-xs text-gray-500 hover:text-gray-700">
              {student.active ? 'Deactiveer' : 'Activeer'}
            </button>
            {student.role === 'student' && (
              <button onClick={() => onSetAdmin(student)} className="text-xs text-orange-600 hover:underline hidden sm:block">
                Admin maken
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
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
