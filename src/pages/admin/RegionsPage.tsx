import { useEffect, useState, type FormEvent } from 'react'
import { listRegions, createRegion, updateRegion, deleteRegion } from '../../lib/api/regions'
import type { Region } from '../../types/reference'
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

const emptyForm = { name: '', is_active: true }

export function RegionsPage() {
  const { staff } = useStaff()
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Region | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setRegions(await listRegions())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load regions')
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
    setModalOpen(true)
  }

  function openEdit(region: Region) {
    setEditing(region)
    setForm({ name: region.name, is_active: region.is_active })
    setModalOpen(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = { name: form.name, is_active: form.is_active }
    try {
      if (editing) {
        await updateRegion(editing.id, input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited region ${input.name}`, 'region', editing.id)
      } else {
        const created = await createRegion(input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created region ${input.name}`, 'region', created.id)
      }
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save region')
    }
  }

  async function remove(region: Region) {
    if (!confirm(`Delete region "${region.name}"?`)) return
    try {
      await deleteRegion(region.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted region ${region.name}`, 'region', region.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete region')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Regions</h1>
        <button onClick={openCreate} className={primaryButtonClass}>
          + New region
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {regions.map((region) => (
          <div key={region.id} className={cardClass}>
            <div className="flex items-start justify-between">
              <p className="font-medium text-neutral-900 dark:text-neutral-100">
                {region.name}
                {!region.is_active && (
                  <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                    inactive
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button onClick={() => openEdit(region)} className={secondaryButtonClass}>
                  Edit
                </button>
                <button onClick={() => remove(region)} className={dangerButtonClass}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {!loading && regions.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No regions yet.</p>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit region' : 'New region'}>
        <form onSubmit={submit}>
          <label className={labelClass}>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />
          <label className="mb-4 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Active
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className={secondaryButtonClass}>
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
