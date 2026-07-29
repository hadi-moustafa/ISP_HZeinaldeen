import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listSubscribers, listDebtSubscriberIds } from '../../lib/api/subscribers'
import { listOwners } from '../../lib/api/owners'
import { listCollectors } from '../../lib/api/collectors'
import { listCompanies } from '../../lib/api/companies'
import { listServices } from '../../lib/api/services'
import type { SubscriberWithRelations } from '../../types/subscribers'
import { emptyFilters } from '../../types/subscribers'
import type { Owner, Collector, Company, ServiceWithCompany } from '../../types/reference'
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, cardClass } from '../../lib/uiClasses'
import { exportToExcel } from '../../lib/exportExcel'

const statusBadgeClass: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  cancelled: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
}

export function SubscribersListPage() {
  const [filters, setFilters] = useState(emptyFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [subscribers, setSubscribers] = useState<SubscriberWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [owners, setOwners] = useState<Owner[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [debtIds, setDebtIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    Promise.all([listOwners(), listCollectors(), listCompanies(), listServices(), listDebtSubscriberIds()])
      .then(([o, c, comp, s, debt]) => {
        setOwners(o)
        setCollectors(c)
        setCompanies(comp)
        setServices(s)
        setDebtIds(debt)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load filters'))
  }, [])

  const filteredServices = useMemo(
    () => (filters.companyId ? services.filter((s) => s.comp_id === filters.companyId) : services),
    [services, filters.companyId],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const serviceIdsForCompany =
      filters.companyId && !filters.serviceId
        ? services.filter((s) => s.comp_id === filters.companyId).map((s) => s.id)
        : null

    const timer = setTimeout(() => {
      listSubscribers(filters, serviceIdsForCompany)
        .then((rows) => {
          if (cancelled) return
          let result = rows
          if (filters.debtMode === 'in_debt') result = result.filter((r) => debtIds.has(r.id))
          if (filters.debtMode === 'paid_up') result = result.filter((r) => !debtIds.has(r.id))
          setSubscribers(result)
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load subscribers')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, services, debtIds])

  function updateFilter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  const activeFilterCount = Object.entries(filters).filter(([key, value]) => {
    if (key === 'debtMode') return value !== 'any'
    return value !== ''
  }).length

  function handleExport() {
    exportToExcel(
      'subscribers',
      subscribers.map((s) => ({
        Name: s.name,
        Phone: s.phone ?? '',
        Service: s.services?.name ?? '',
        Company: s.services?.companies?.name ?? '',
        Owner: s.owners?.name ?? '',
        'Default Collector': s.default_collector?.name ?? '',
        Status: s.connection_status,
        'Expiry Date': s.expiry_date ?? '',
        'In Debt': debtIds.has(s.id) ? 'Yes' : 'No',
      })),
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Subscribers
        </h1>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleExport} className={secondaryButtonClass}>
            Export to Excel
          </button>
          <Link to="/subscribers/new" className={primaryButtonClass}>
            + New subscriber
          </Link>
        </div>
      </div>

      <div className="mb-4">
        <input
          value={filters.search}
          onChange={(e) => updateFilter('search', e.target.value)}
          placeholder="Search name or phone…"
          className={inputClass}
        />
      </div>

      <button
        onClick={() => setFiltersOpen((v) => !v)}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400"
      >
        {filtersOpen ? 'Hide filters' : 'Filters'}
        {activeFilterCount > 0 && ` (${activeFilterCount} active)`}
      </button>

      {filtersOpen && (
        <div className={`${cardClass} mb-4 space-y-3`}>
          <div>
            <label className={labelClass}>Owner</label>
            <select
              value={filters.ownerId}
              onChange={(e) => updateFilter('ownerId', e.target.value)}
              className={inputClass}
            >
              <option value="">Any</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Default collector</label>
            <select
              value={filters.collectorId}
              onChange={(e) => updateFilter('collectorId', e.target.value)}
              className={inputClass}
            >
              <option value="">Any</option>
              {collectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Company</label>
            <select
              value={filters.companyId}
              onChange={(e) => {
                updateFilter('companyId', e.target.value)
                updateFilter('serviceId', '')
              }}
              className={inputClass}
            >
              <option value="">Any</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Service</label>
            <select
              value={filters.serviceId}
              onChange={(e) => updateFilter('serviceId', e.target.value)}
              className={inputClass}
            >
              <option value="">Any</option>
              {filteredServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Connection status</label>
            <select
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value as typeof filters.status)}
              className={inputClass}
            >
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Debt status</label>
            <select
              value={filters.debtMode}
              onChange={(e) => updateFilter('debtMode', e.target.value as typeof filters.debtMode)}
              className={inputClass}
            >
              <option value="any">Any</option>
              <option value="in_debt">In debt (unpaid/partial)</option>
              <option value="paid_up">Paid up</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Expiry from</label>
              <input
                type="date"
                value={filters.expiryFrom}
                onChange={(e) => updateFilter('expiryFrom', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Expiry to</label>
              <input
                type="date"
                value={filters.expiryTo}
                onChange={(e) => updateFilter('expiryTo', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <button onClick={() => setFilters(emptyFilters)} className={secondaryButtonClass}>
            Clear filters
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {subscribers.map((sub) => (
          <Link key={sub.id} to={`/subscribers/${sub.id}`} className={`${cardClass} block`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {sub.name}
                  {debtIds.has(sub.id) && (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">
                      debt
                    </span>
                  )}
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {sub.phone ?? '—'}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  {sub.services?.name ?? 'No service'}
                  {sub.services?.companies?.name && ` · ${sub.services.companies.name}`}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Owner: {sub.owners?.name ?? '—'} · Collector: {sub.default_collector?.name ?? '—'}
                </p>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass[sub.connection_status]}`}
              >
                {sub.connection_status}
              </span>
            </div>
          </Link>
        ))}
        {!loading && subscribers.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No subscribers match these filters.</p>
        )}
      </div>
    </div>
  )
}
