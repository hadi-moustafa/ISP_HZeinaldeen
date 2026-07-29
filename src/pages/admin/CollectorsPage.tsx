import { useEffect, useState, type FormEvent } from 'react'
import {
  listCollectors,
  createCollector,
  updateCollector,
  deleteCollector,
} from '../../lib/api/collectors'
import type { Collector } from '../../types/reference'
import { Modal } from '../../components/Modal'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
  cardClass,
} from '../../lib/uiClasses'

const emptyForm = { name: '', phone: '', is_active: true }

export function CollectorsPage() {
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Collector | null>(null)
  const [form, setForm] = useState(emptyForm)

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
    setModalOpen(true)
  }

  function openEdit(collector: Collector) {
    setEditing(collector)
    setForm({
      name: collector.name,
      phone: collector.phone ?? '',
      is_active: collector.is_active,
    })
    setModalOpen(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = { name: form.name, phone: form.phone || null, is_active: form.is_active }
    try {
      if (editing) {
        await updateCollector(editing.id, input)
      } else {
        await createCollector(input)
      }
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save collector')
    }
  }

  async function remove(collector: Collector) {
    if (!confirm(`Delete collector "${collector.name}"?`)) return
    try {
      await deleteCollector(collector.id)
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
