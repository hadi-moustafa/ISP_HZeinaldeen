import { useEffect, useState, type FormEvent } from 'react'
import {
  listCollectors,
  createCollector,
  updateCollector,
  deleteCollector,
} from '../../lib/api/collectors'
import {
  getCollectorStaff,
  createCollectorLogin,
  updateCollectorLoginUsername,
  resetCollectorLoginPassword,
  deleteCollectorLogin,
} from '../../lib/api/staff'
import type { Collector } from '../../types/reference'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import { Modal } from '../../components/Modal'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
  cardClass,
} from '../../lib/uiClasses'

const emptyForm = { name: '', phone: '', is_active: true, username: '', password: '' }

export function CollectorsPage() {
  const { staff } = useStaff()
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Collector | null>(null)
  const [form, setForm] = useState(emptyForm)

  // Set only when editing a collector that already has a login -- tells
  // submit() whether to update that login or create a new one.
  const [existingStaffId, setExistingStaffId] = useState<string | null>(null)
  const [originalUsername, setOriginalUsername] = useState('')

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setCollectors(await listCollectors())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collectors')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setExistingStaffId(null)
    setOriginalUsername('')
    setError(null)
    setModalOpen(true)
  }

  // Opens immediately with the collector's own fields, then fills in its
  // login (if any) once fetched -- no need to block opening the modal on it.
  async function openEdit(collector: Collector) {
    setEditing(collector)
    setForm({
      name: collector.name,
      phone: collector.phone ?? '',
      is_active: collector.is_active,
      username: '',
      password: '',
    })
    setExistingStaffId(null)
    setOriginalUsername('')
    setError(null)
    setModalOpen(true)
    try {
      const staffRow = await getCollectorStaff(collector.id)
      if (staffRow) {
        setExistingStaffId(staffRow.id)
        setOriginalUsername(staffRow.username)
        setForm((f) => ({ ...f, username: staffRow.username }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load login info')
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const input = { name: form.name, phone: form.phone || null, is_active: form.is_active }
    const username = form.username.trim()

    try {
      if (editing) {
        await updateCollector(editing.id, input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited collector ${input.name}`, 'collector', editing.id)

        if (existingStaffId) {
          if (username && username !== originalUsername) {
            await updateCollectorLoginUsername(existingStaffId, username)
          }
          if (form.password) {
            await resetCollectorLoginPassword(existingStaffId, form.password)
          }
        } else if (username || form.password) {
          if (!username || !form.password) {
            setError("Enter both a username and password to set up this collector's login.")
            return
          }
          await createCollectorLogin(editing.id, username, form.password)
        }
      } else {
        // Creating a collector now requires a login -- if that fails (e.g.
        // duplicate username), roll back the collector record rather than
        // leaving one behind with no way for that person to sign in.
        const created = await createCollector(input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created collector ${input.name}`, 'collector', created.id)
        try {
          await createCollectorLogin(created.id, username, form.password)
        } catch (loginErr) {
          await deleteCollector(created.id)
          throw loginErr
        }
      }
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save collector')
    }
  }

  async function remove(collector: Collector) {
    if (!confirm(`Delete collector "${collector.name}"? This also removes their login.`)) return
    try {
      await deleteCollectorLogin(collector.id)
      await deleteCollector(collector.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted collector ${collector.name}`, 'collector', collector.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete collector')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Collectors
        </h1>
        <button onClick={openCreate} className={primaryButtonClass}>
          + New collector
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {collectors.map((collector) => (
          <div key={collector.id} className={cardClass}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {collector.name}
                  {!collector.is_active && (
                    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                      inactive
                    </span>
                  )}
                </p>
                {collector.phone && (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {collector.phone}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(collector)} className={secondaryButtonClass}>
                  Edit
                </button>
                <button onClick={() => remove(collector)} className={dangerButtonClass}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {!loading && collectors.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No collectors yet.</p>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit collector' : 'New collector'}
      >
        <form onSubmit={submit}>
          <label className={labelClass}>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />
          <label className={labelClass}>Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <label className="mb-4 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Active
          </label>

          <div className="mb-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Login (for this collector to sign in)
            </p>
          </div>
          <label className={labelClass}>Username</label>
          <input
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            className={`${inputClass} mb-4`}
            required={!editing}
            autoComplete="off"
          />
          <label className={labelClass}>
            Password
            {editing && existingStaffId ? ' (leave blank to keep the current one)' : ''}
          </label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className={`${inputClass} mb-4`}
            required={!editing}
            autoComplete="new-password"
          />
          {editing && !existingStaffId && (
            <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
              This collector has no login yet -- fill in both fields to create one.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass}>
              Save
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
