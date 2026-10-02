import { useEffect, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { useStaff } from '../../context/StaffContext'
import {
  listTechnicians,
  createTechnicianLogin,
  updateTechnician,
  deleteTechnician,
  resetCollectorLoginPassword,
  type TechnicianStaff,
} from '../../lib/api/staff'
import { logActivity } from '../../lib/api/activityLog'
import { Modal } from '../../components/Modal'
import { inputClass, primaryButtonClass, secondaryButtonClass, dangerButtonClass, cardClass } from '../../lib/uiClasses'

// Technician logins: these accounts can only open their own Tasks page.
export function TechniciansPage() {
  const { staff } = useStaff()
  const [technicians, setTechnicians] = useState<TechnicianStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<TechnicianStaff | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function refresh() {
    listTechnicians()
      .then(setTechnicians)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load technicians'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  function openCreate() {
    setEditing(null)
    setUsername('')
    setPassword('')
    setIsActive(true)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(t: TechnicianStaff) {
    setEditing(t)
    setUsername(t.username)
    setPassword('')
    setIsActive(t.is_active)
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!staff) return
    const name = username.trim()
    if (!name) return setFormError('Enter a username.')
    if (!editing && password.length < 4) return setFormError('Password must be at least 4 characters.')
    if (editing && password && password.length < 4) return setFormError('Password must be at least 4 characters.')
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await updateTechnician(editing.id, { username: name, is_active: isActive })
        if (password) await resetCollectorLoginPassword(editing.id, password)
        const changes = [
          name !== editing.username ? `renamed to ${name}` : null,
          password ? 'password changed' : null,
          isActive !== editing.is_active ? (isActive ? 'activated' : 'deactivated') : null,
        ].filter(Boolean)
        logActivity(
          staff.id,
          `${staff.username} edited technician account ${editing.username}${changes.length ? ` (${changes.join(', ')})` : ''}`,
          'technician',
          editing.id,
        )
      } else {
        const id = await createTechnicianLogin(name, password)
        logActivity(staff.id, `${staff.username} created technician account ${name}`, 'technician', id)
      }
      setModalOpen(false)
      refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save'
      setFormError(msg.includes('staff_username_key') ? 'That username is already taken.' : msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!staff || !editing) return
    if (!confirm(`Delete technician account ${editing.username}? Their finished tasks stay in the history.`)) return
    try {
      await deleteTechnician(editing.id)
      logActivity(staff.id, `${staff.username} deleted technician account ${editing.username}`, 'technician', editing.id)
      setModalOpen(false)
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-lg font-semibold text-neutral-900">Technicians</h1>
        <button
          onClick={openCreate}
          className="ml-auto flex items-center gap-1 rounded-full bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} /> New account
        </button>
      </div>
      <p className="mb-3 text-sm text-neutral-500">Technician accounts can only see their Tasks page.</p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {!loading && technicians.length === 0 && (
        <p className={`${cardClass} text-sm text-neutral-500`}>No technician accounts yet.</p>
      )}

      <div className="space-y-1.5">
        {technicians.map((t) => (
          <button
            key={t.id}
            onClick={() => openEdit(t)}
            className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left"
          >
            <span className="flex-1 text-sm font-semibold text-neutral-900">{t.username}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                t.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-200 text-neutral-500'
              }`}
            >
              {t.is_active ? 'Active' : 'Inactive'}
            </span>
          </button>
        ))}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.username}` : 'New technician account'}
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              {editing ? 'New password (leave blank to keep)' : 'Password'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active (can log in)
            </label>
          )}
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex items-center gap-2">
            {editing && (
              <button type="button" onClick={handleDelete} className={dangerButtonClass}>
                Delete
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className={secondaryButtonClass}>
                Cancel
              </button>
              <button type="submit" disabled={saving} className={primaryButtonClass}>
                {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
