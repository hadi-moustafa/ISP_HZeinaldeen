import { useEffect, useState, type FormEvent } from 'react'
import { listAddresses, createAddress, updateAddress, deleteAddress } from '../../lib/api/addresses'
import { listRegions, createRegion, updateRegion, deleteRegion } from '../../lib/api/regions'
import type { Address, Region } from '../../types/reference'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import { Modal } from '../../components/Modal'
import { inputClass, primaryButtonClass, secondaryButtonClass, dangerButtonClass, cardClass } from '../../lib/uiClasses'

const emptyForm = { name: '', is_active: true }
const emptyRegionForm = { name: '', is_active: true }

// Regions are scoped under one address (0027_regions_under_address.sql) --
// managed here, inside a modal per address, rather than as their own
// top-level admin page, since a region only ever makes sense in the
// context of the address that owns it.
function RegionsModal({ address, onClose }: { address: Address | null; onClose: () => void }) {
  const { staff } = useStaff()
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Region | null>(null)
  const [form, setForm] = useState(emptyRegionForm)

  async function refresh(addressId: string) {
    setLoading(true)
    setError(null)
    try {
      setRegions(await listRegions(addressId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load regions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (address) {
      setEditing(null)
      setForm(emptyRegionForm)
      refresh(address.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!address) return
    try {
      if (editing) {
        await updateRegion(editing.id, { name: form.name, is_active: form.is_active })
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited region ${form.name} (${address.name})`, 'region', editing.id)
      } else {
        const created = await createRegion({ address_id: address.id, name: form.name, is_active: form.is_active })
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created region ${form.name} under ${address.name}`, 'region', created.id)
      }
      setEditing(null)
      setForm(emptyRegionForm)
      await refresh(address.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save region')
    }
  }

  async function remove(region: Region) {
    if (!address) return
    if (!confirm(`Delete region "${region.name}"?`)) return
    try {
      await deleteRegion(region.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted region ${region.name}`, 'region', region.id)
      await refresh(address.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete region')
    }
  }

  // Deliberately NOT `if (!address) return null` before this: Modal has to
  // stay mounted across open/closed, or it mounts fresh on open and
  // StrictMode's double-invoked effect runs its history cleanup
  // (window.history.back()), and the resulting popstate closes the modal
  // immediately. Same always-mounted shape as every other Modal call site.
  return (
    <Modal open={Boolean(address)} onClose={onClose} title={address ? `Regions in ${address.name}` : 'Regions'}>
      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="mb-4 space-y-2">
        {regions.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
            <span className="text-sm text-neutral-800 dark:text-neutral-100">
              {r.name}
              {!r.is_active && (
                <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                  inactive
                </span>
              )}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditing(r)
                  setForm({ name: r.name, is_active: r.is_active })
                }}
                className="text-xs font-medium text-indigo-600"
              >
                Edit
              </button>
              <button onClick={() => remove(r)} className="text-xs font-medium text-red-600">
                Delete
              </button>
            </div>
          </div>
        ))}
        {!loading && regions.length === 0 && address && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No regions in {address.name} yet.</p>
        )}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2">
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder={editing ? 'Edit region name' : 'New region name'}
          className={`${inputClass} flex-1`}
          required
        />
        <button type="submit" className={primaryButtonClass}>
          {editing ? 'Save' : 'Add'}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setForm(emptyRegionForm)
            }}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
        )}
      </form>
    </Modal>
  )
}

export function AddressesPage() {
  const { staff } = useStaff()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Address | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [regionsFor, setRegionsFor] = useState<Address | null>(null)

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
                <button onClick={() => setRegionsFor(address)} className={secondaryButtonClass}>
                  Regions
                </button>
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

      <RegionsModal address={regionsFor} onClose={() => setRegionsFor(null)} />
    </div>
  )
}
