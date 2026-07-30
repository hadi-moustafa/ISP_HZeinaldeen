import { useEffect, useState, type FormEvent } from 'react'
import {
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  listCompanyAddresses,
  createCompanyAddress,
  updateCompanyAddress,
  deleteCompanyAddress,
} from '../../lib/api/companies'
import type { Company, CompanyAddress } from '../../types/reference'
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

const emptyAddressForm = {
  label: 'main',
  line1: '',
  line2: '',
  city: '',
  region: '',
  country: '',
  is_primary: false,
}

export function CompaniesPage() {
  const { staff } = useStaff()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<Record<string, CompanyAddress[]>>({})

  const [companyModalOpen, setCompanyModalOpen] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [companyForm, setCompanyForm] = useState({ name: '', notes: '' })

  const [addressModalOpen, setAddressModalOpen] = useState(false)
  const [addressCompanyId, setAddressCompanyId] = useState<string | null>(null)
  const [editingAddress, setEditingAddress] = useState<CompanyAddress | null>(null)
  const [addressForm, setAddressForm] = useState(emptyAddressForm)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setCompanies(await listCompanies())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function toggleExpand(companyId: string) {
    if (expandedId === companyId) {
      setExpandedId(null)
      return
    }
    setExpandedId(companyId)
    if (!addresses[companyId]) {
      try {
        const rows = await listCompanyAddresses(companyId)
        setAddresses((prev) => ({ ...prev, [companyId]: rows }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load addresses')
      }
    }
  }

  function openCreateCompany() {
    setEditingCompany(null)
    setCompanyForm({ name: '', notes: '' })
    setCompanyModalOpen(true)
  }

  function openEditCompany(company: Company) {
    setEditingCompany(company)
    setCompanyForm({ name: company.name, notes: company.notes ?? '' })
    setCompanyModalOpen(true)
  }

  async function submitCompany(e: FormEvent) {
    e.preventDefault()
    const input = { name: companyForm.name, notes: companyForm.notes || null }
    try {
      if (editingCompany) {
        await updateCompany(editingCompany.id, input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} edited company ${input.name}`, 'company', editingCompany.id)
      } else {
        const created = await createCompany(input)
        logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} created company ${input.name}`, 'company', created.id)
      }
      setCompanyModalOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save company')
    }
  }

  async function removeCompany(company: Company) {
    if (!confirm(`Delete company "${company.name}"? This fails if it still has services.`)) return
    try {
      await deleteCompany(company.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted company ${company.name}`, 'company', company.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete company')
    }
  }

  function openCreateAddress(companyId: string) {
    setAddressCompanyId(companyId)
    setEditingAddress(null)
    setAddressForm(emptyAddressForm)
    setAddressModalOpen(true)
  }

  function openEditAddress(companyId: string, address: CompanyAddress) {
    setAddressCompanyId(companyId)
    setEditingAddress(address)
    setAddressForm({
      label: address.label ?? '',
      line1: address.line1 ?? '',
      line2: address.line2 ?? '',
      city: address.city ?? '',
      region: address.region ?? '',
      country: address.country ?? '',
      is_primary: address.is_primary,
    })
    setAddressModalOpen(true)
  }

  async function submitAddress(e: FormEvent) {
    e.preventDefault()
    if (!addressCompanyId) return
    const input = {
      label: addressForm.label || null,
      line1: addressForm.line1 || null,
      line2: addressForm.line2 || null,
      city: addressForm.city || null,
      region: addressForm.region || null,
      country: addressForm.country || null,
      is_primary: addressForm.is_primary,
    }
    try {
      if (editingAddress) {
        await updateCompanyAddress(editingAddress.id, input)
      } else {
        await createCompanyAddress(addressCompanyId, input)
      }
      setAddressModalOpen(false)
      const rows = await listCompanyAddresses(addressCompanyId)
      setAddresses((prev) => ({ ...prev, [addressCompanyId]: rows }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save address')
    }
  }

  async function removeAddress(companyId: string, addressId: string) {
    if (!confirm('Delete this address?')) return
    try {
      await deleteCompanyAddress(addressId)
      const rows = await listCompanyAddresses(companyId)
      setAddresses((prev) => ({ ...prev, [companyId]: rows }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete address')
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Companies
        </h1>
        <button onClick={openCreateCompany} className={primaryButtonClass}>
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
                <button
                  onClick={() => openEditCompany(company)}
                  className={secondaryButtonClass}
                >
                  Edit
                </button>
                <button
                  onClick={() => removeCompany(company)}
                  className={dangerButtonClass}
                >
                  Delete
                </button>
              </div>
            </div>

            <button
              onClick={() => toggleExpand(company.id)}
              className="mt-3 text-sm text-blue-600 dark:text-blue-400"
            >
              {expandedId === company.id ? 'Hide addresses' : 'Show addresses'}
            </button>

            {expandedId === company.id && (
              <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
                {(addresses[company.id] ?? []).map((address) => (
                  <div
                    key={address.id}
                    className="flex items-start justify-between rounded-md bg-neutral-50 p-2 text-sm dark:bg-neutral-700/50"
                  >
                    <div>
                      <p className="font-medium text-neutral-800 dark:text-neutral-100">
                        {address.label}
                        {address.is_primary && (
                          <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                            primary
                          </span>
                        )}
                      </p>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        {[address.line1, address.city, address.region, address.country]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => openEditAddress(company.id, address)}
                        className="text-blue-600 dark:text-blue-400"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => removeAddress(company.id, address.id)}
                        className="text-red-600 dark:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => openCreateAddress(company.id)}
                  className="text-sm text-blue-600 dark:text-blue-400"
                >
                  + Add address
                </button>
              </div>
            )}
          </div>
        ))}
        {!loading && companies.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No companies yet.</p>
        )}
      </div>

      <Modal
        open={companyModalOpen}
        onClose={() => setCompanyModalOpen(false)}
        title={editingCompany ? 'Edit company' : 'New company'}
      >
        <form onSubmit={submitCompany}>
          <label className={labelClass}>Name</label>
          <input
            value={companyForm.name}
            onChange={(e) => setCompanyForm((f) => ({ ...f, name: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />
          <label className={labelClass}>Notes</label>
          <textarea
            value={companyForm.notes}
            onChange={(e) => setCompanyForm((f) => ({ ...f, notes: e.target.value }))}
            className={`${inputClass} mb-4`}
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCompanyModalOpen(false)}
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

      <Modal
        open={addressModalOpen}
        onClose={() => setAddressModalOpen(false)}
        title={editingAddress ? 'Edit address' : 'New address'}
      >
        <form onSubmit={submitAddress}>
          <label className={labelClass}>Label</label>
          <input
            value={addressForm.label}
            onChange={(e) => setAddressForm((f) => ({ ...f, label: e.target.value }))}
            className={`${inputClass} mb-4`}
            placeholder="main office, warehouse..."
          />
          <label className={labelClass}>Address line 1</label>
          <input
            value={addressForm.line1}
            onChange={(e) => setAddressForm((f) => ({ ...f, line1: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <label className={labelClass}>Address line 2</label>
          <input
            value={addressForm.line2}
            onChange={(e) => setAddressForm((f) => ({ ...f, line2: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>City</label>
              <input
                value={addressForm.city}
                onChange={(e) => setAddressForm((f) => ({ ...f, city: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Region</label>
              <input
                value={addressForm.region}
                onChange={(e) => setAddressForm((f) => ({ ...f, region: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>
          <label className={labelClass}>Country</label>
          <input
            value={addressForm.country}
            onChange={(e) => setAddressForm((f) => ({ ...f, country: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <label className="mb-4 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={addressForm.is_primary}
              onChange={(e) =>
                setAddressForm((f) => ({ ...f, is_primary: e.target.checked }))
              }
            />
            Primary address
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddressModalOpen(false)}
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
