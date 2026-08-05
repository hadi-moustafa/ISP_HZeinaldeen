import { useEffect, useState, type FormEvent } from 'react'
import { listCompaniesWithSubscriberCount, createCompany, updateCompany, deleteCompany } from '../../lib/api/companies'
import type { CompanyWithStats } from '../../types/reference'
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

const emptyForm = { name: '', notes: '', payment_phone: '', support_phone: '' }

export function CompaniesPage() {
  const { staff } = useStaff()
  const [companies, setCompanies] = useState<CompanyWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CompanyWithStats | null>(null)
  const [form, setForm] = useState(emptyForm)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setCompanies(await listCompaniesWithSubscriberCount())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies')
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

  function openEdit(company: CompanyWithStats) {
    setEditing(company)
    setForm({
      name: company.name,
      notes: company.notes ?? '',
      payment_phone: company.payment_phone ?? '',
      support_phone: company.support_phone ?? '',
    })
    setModalOpen(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = {
      name: form.name,
      notes: form.notes || null,
      payment_phone: form.payment_phone || null,
      support_phone: form.support_phone || null,
    }
    try {
      if (editing) {
        await updateCompany(editing.id, input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited company ${input.name}`, 'company', editing.id)
      } else {
        const created = await createCompany(input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created company ${input.name}`, 'company', created.id)
      }
      setModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save company')
    }
  }

  async function remove(company: CompanyWithStats) {
    if (!confirm(`Delete company "${company.name}"? This fails if it still has services.`)) return
    try {
      await deleteCompany(company.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted company ${company.name}`, 'company', company.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete company')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Companies
        </h1>
        <button onClick={openCreate} className={primaryButtonClass}>
          + New company
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {companies.map((company) => (
          <div key={company.id} className={cardClass}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {company.name}
                </p>
                {company.notes && (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {company.notes}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(company)} className={secondaryButtonClass}>
                  Edit
                </button>
                <button onClick={() => remove(company)} className={dangerButtonClass}>
                  Delete
                </button>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-neutral-400">Payment phone</dt>
                <dd className="text-neutral-700 dark:text-neutral-300">
                  {company.payment_phone ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-400">Support phone</dt>
                <dd className="text-neutral-700 dark:text-neutral-300">
                  {company.support_phone ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-400">Subscribers</dt>
                <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                  {company.subscriber_count}
                </dd>
              </div>
            </dl>
          </div>
        ))}
        {!loading && companies.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No companies yet.</p>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit company' : 'New company'}
      >
        <form onSubmit={submit}>
          <label className={labelClass}>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />
          <label className={labelClass}>Payment phone</label>
          <input
            type="tel"
            value={form.payment_phone}
            onChange={(e) => setForm((f) => ({ ...f, payment_phone: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <label className={labelClass}>Support phone</label>
          <input
            type="tel"
            value={form.support_phone}
            onChange={(e) => setForm((f) => ({ ...f, support_phone: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <label className={labelClass}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className={`${inputClass} mb-4`}
            rows={3}
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
