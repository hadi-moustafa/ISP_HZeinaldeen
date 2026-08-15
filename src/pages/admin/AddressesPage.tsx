import { useEffect, useState, type FormEvent } from 'react'
import { listAddresses, createAddress, updateAddress, deleteAddress } from '../../lib/api/addresses'
import type { Address } from '../../types/reference'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import { Modal } from '../../components/Modal'
import { inputClass, primaryButtonClass, secondaryButtonClass, dangerButtonClass, cardClass } from '../../lib/uiClasses'

const emptyForm = { name: '', is_active: true }

export function AddressesPage() {
  const { staff } = useStaff()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Address | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setAddresses(await listAddresses())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load addresses')
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

  function openEdit(address: Address) {
    setEditing(address)
    setForm({ name: address.name, is_active: address.is_active })
    setModalOpen(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = { name: form.name, is_active: form.is_active }
    try {
      if (editing) {
        await updateAddress(editing.id, input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited address ${input.name}`, 'address', editing.id)
      } else {
        const created = await createAddress(input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created address ${input.name}`, 'address', created.id)
      }
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save address')
    }
  }

  async function remove(address: Address) {
    if (!confirm(`Delete address "${address.name}"?`)) return
    try {
      await deleteAddress(address.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted address ${address.name}`, 'address', address.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete address')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Addresses</h1>
        <button onClick={openCreate} className={primaryButtonClass}>
          + New address
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {addresses.map((address) => (
          <div key={address.id} className={cardClass}>
            <div className="flex items-start justify-between">
              <p className="font-medium text-neutral-900 dark:text-neutral-100">
                {address.name}
                {!address.is_active && (
                  <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                    inactive
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button onClick={() => openEdit(address)} className={secondaryButtonClass}>
                  Edit
                </button>
                <button onClick={() => remove(address)} className={dangerButtonClass}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {!loading && addresses.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No addresses yet.</p>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit address' : 'New address'}>
        <form onSubmit={submit}>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name"
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
