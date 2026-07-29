import { useEffect, useState, type FormEvent } from 'react'
import { listServices, createService, updateService, deleteService } from '../../lib/api/services'
import { listCompanies } from '../../lib/api/companies'
import type { Company, ServiceWithCompany } from '../../types/reference'
import { Modal } from '../../components/Modal'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
  cardClass,
} from '../../lib/uiClasses'

const emptyForm = {
  comp_id: '',
  name: '',
  sell_price: '',
  paid_price: '',
  is_active: true,
}

export function ServicesPage() {
  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceWithCompany | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const [svc, comp] = await Promise.all([listServices(), listCompanies()])
      setServices(svc)
      setCompanies(comp)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm, comp_id: companies[0]?.id ?? '' })
    setModalOpen(true)
  }

  function openEdit(service: ServiceWithCompany) {
    setEditing(service)
    setForm({
      comp_id: service.comp_id,
      name: service.name,
      sell_price: String(service.sell_price),
      paid_price: String(service.paid_price),
      is_active: service.is_active,
    })
    setModalOpen(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = {
      comp_id: form.comp_id,
      name: form.name,
      sell_price: Number(form.sell_price),
      paid_price: Number(form.paid_price),
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await updateService(editing.id, input)
      } else {
        await createService(input)
      }
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save service')
    }
  }

  async function remove(service: ServiceWithCompany) {
    if (!confirm(`Delete service "${service.name}"? This fails if subscribers use it.`)) return
    try {
      await deleteService(service.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete service')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Services
        </h1>
        <button
          onClick={openCreate}
          disabled={companies.length === 0}
          className={primaryButtonClass}
        >
          + New service
        </button>
      </div>

      {companies.length === 0 && !loading && (
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Add a company first before creating services.
        </p>
      )}
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {services.map((service) => (
          <div key={service.id} className={cardClass}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {service.name}
                  {!service.is_active && (
                    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                      inactive
                    </span>
                  )}
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {service.companies?.name ?? 'Unknown company'}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Sell {service.sell_price} · Pay {service.paid_price}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(service)} className={secondaryButtonClass}>
                  Edit
                </button>
                <button onClick={() => remove(service)} className={dangerButtonClass}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {!loading && services.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No services yet.</p>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit service' : 'New service'}
      >
        <form onSubmit={submit}>
          <label className={labelClass}>Company</label>
          <select
            value={form.comp_id}
            onChange={(e) => setForm((f) => ({ ...f, comp_id: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label className={labelClass}>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Sell price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.sell_price}
                onChange={(e) => setForm((f) => ({ ...f, sell_price: e.target.value }))}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Paid price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.paid_price}
                onChange={(e) => setForm((f) => ({ ...f, paid_price: e.target.value }))}
                className={inputClass}
                required
              />
            </div>
          </div>

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
