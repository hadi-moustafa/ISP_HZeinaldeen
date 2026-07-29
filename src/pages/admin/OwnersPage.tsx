import { useEffect, useState, type FormEvent } from 'react'
import { listOwners, createOwner, updateOwner, deleteOwner } from '../../lib/api/owners'
import type { Owner } from '../../types/reference'
import { Modal } from '../../components/Modal'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
  cardClass,
} from '../../lib/uiClasses'

const emptyForm = { name: '', phone: '' }

export function OwnersPage() {
  const [owners, setOwners] = useState<Owner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Owner | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setOwners(await listOwners())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load owners')
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

  function openEdit(owner: Owner) {
    setEditing(owner)
    setForm({ name: owner.name, phone: owner.phone ?? '' })
    setModalOpen(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = { name: form.name, phone: form.phone || null }
    try {
      if (editing) {
        await updateOwner(editing.id, input)
      } else {
        await createOwner(input)
      }
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save owner')
    }
  }

  async function remove(owner: Owner) {
    if (!confirm(`Delete owner "${owner.name}"?`)) return
    try {
      await deleteOwner(owner.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete owner')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Owners
        </h1>
        <button onClick={openCreate} className={primaryButtonClass}>
          + New owner
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {owners.map((owner) => (
          <div key={owner.id} className={cardClass}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {owner.name}
                </p>
                {owner.phone && (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {owner.phone}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(owner)} className={secondaryButtonClass}>
                  Edit
                </button>
                <button onClick={() => remove(owner)} className={dangerButtonClass}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {!loading && owners.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No owners yet.</p>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit owner' : 'New owner'}
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
