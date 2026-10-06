import { useState } from 'react'
import type { SubscriberFilters } from '../../types/subscribers'
import type { Collector, Company, Owner, ServiceWithCompany } from '../../types/reference'

type RefineField = '' | 'collector' | 'company' | 'service' | 'owner' | 'status' | 'nationality'

const FIELDS: { value: RefineField; label: string }[] = [
  { value: '', label: 'And also…' },
  { value: 'collector', label: 'Collector' },
  { value: 'company', label: 'Company' },
  { value: 'service', label: 'Service' },
  { value: 'owner', label: 'Owner' },
  { value: 'status', label: 'Status' },
  { value: 'nationality', label: 'Nationality' },
]

// The filters an "And also" field writes to -- cleared when the field
// changes, so a hidden leftover never keeps narrowing the list.
const CLEARS: Partial<SubscriberFilters> = {
  collectorId: '',
  companyId: '',
  serviceId: '',
  ownerId: '',
  status: '',
  nationality: '',
}

// A second filter on top of an address filter: pick one more field
// (collector, company, service, owner, status, nationality) and a value.
// Writes into the same filters object the list is already queried with.
export function AddressRefine({
  filters,
  setFilters,
  collectors,
  companies,
  services,
  owners,
  className,
}: {
  filters: SubscriberFilters
  setFilters: (update: (f: SubscriberFilters) => SubscriberFilters) => void
  collectors: Collector[]
  companies: Company[]
  services: ServiceWithCompany[]
  owners: Owner[]
  className: string
}) {
  const [field, setField] = useState<RefineField>(() =>
    filters.collectorId
      ? 'collector'
      : filters.serviceId
        ? 'service'
        : filters.companyId
          ? 'company'
          : filters.ownerId
            ? 'owner'
            : filters.status
              ? 'status'
              : filters.nationality
                ? 'nationality'
                : '',
  )

  function pickField(next: RefineField) {
    setField(next)
    setFilters((f) => ({ ...f, ...CLEARS }))
  }

  const set = (patch: Partial<SubscriberFilters>) => setFilters((f) => ({ ...f, ...patch }))

  return (
    <>
      <select value={field} onChange={(e) => pickField(e.target.value as RefineField)} className={className}>
        {FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {field === 'collector' && (
        <select value={filters.collectorId} onChange={(e) => set({ collectorId: e.target.value })} className={className}>
          <option value="">Any collector</option>
          {collectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {field === 'company' && (
        <select
          value={filters.companyId}
          onChange={(e) => set({ companyId: e.target.value, serviceId: '' })}
          className={className}
        >
          <option value="">Any company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {field === 'service' && (
        <select value={filters.serviceId} onChange={(e) => set({ serviceId: e.target.value })} className={className}>
          <option value="">Any service</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {field === 'owner' && (
        <select value={filters.ownerId} onChange={(e) => set({ ownerId: e.target.value })} className={className}>
          <option value="">Any owner</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      {field === 'status' && (
        <select
          value={filters.status}
          onChange={(e) => set({ status: e.target.value as SubscriberFilters['status'] })}
          className={className}
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
        </select>
      )}
      {field === 'nationality' && (
        <select
          value={filters.nationality}
          onChange={(e) => set({ nationality: e.target.value as SubscriberFilters['nationality'] })}
          className={className}
        >
          <option value="">Any nationality</option>
          <option value="Lebanese">Lebanese</option>
          <option value="Syrian">Syrian</option>
        </select>
      )}
    </>
  )
}
