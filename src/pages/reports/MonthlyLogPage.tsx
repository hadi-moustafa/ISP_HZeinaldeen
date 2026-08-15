import { useEffect, useMemo, useState } from 'react'
import { listMonthlyLog, listMonthlyFinancials } from '../../lib/api/reports'
import { listCompanies } from '../../lib/api/companies'
import { listServices } from '../../lib/api/services'
import { listOwners } from '../../lib/api/owners'
import { listCollectors } from '../../lib/api/collectors'
import type { MonthlyLogRow } from '../../types/reports'
import type { Company, ServiceWithCompany, Owner, Collector } from '../../types/reference'
import { exportToExcel } from '../../lib/exportExcel'
import { inputClass, primaryButtonClass, secondaryButtonClass, cardClass } from '../../lib/uiClasses'

const statusBadgeClass: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  postponed: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  waived: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
}

type SortMode = 'name' | 'due' | 'paid' | 'due_date' | 'collected'

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function MonthlyLogPage() {
  const [month, setMonth] = useState(currentMonthValue())
  const [rows, setRows] = useState<MonthlyLogRow[]>([])
  const [servicesTotal, setServicesTotal] = useState(0)
  const [productsTotal, setProductsTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onlyUnpaid, setOnlyUnpaid] = useState(false)

  const [companies, setCompanies] = useState<Company[]>([])
  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [owners, setOwners] = useState<Owner[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])

  const [companyId, setCompanyId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [collectorId, setCollectorId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [sortDesc, setSortDesc] = useState(false)

  const periodMonth = `${month}-01`

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([listMonthlyLog(periodMonth), listMonthlyFinancials()])
      .then(([logRows, financials]) => {
        setRows(logRows)
        const forMonth = financials.filter((f) => f.period_month === periodMonth)
        setServicesTotal(forMonth.find((f) => f.revenue_type === 'services')?.total ?? 0)
        setProductsTotal(forMonth.find((f) => f.revenue_type === 'products')?.total ?? 0)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load monthly log'))
      .finally(() => setLoading(false))
  }, [periodMonth])

  useEffect(() => {
    listCompanies().then(setCompanies).catch(() => {})
    listServices().then(setServices).catch(() => {})
    listOwners().then(setOwners).catch(() => {})
    listCollectors().then(setCollectors).catch(() => {})
  }, [])

  const filteredServices = useMemo(
    () => (companyId ? services.filter((s) => s.comp_id === companyId) : services),
    [services, companyId],
  )

  const visibleRows = useMemo(() => {
    let result = rows
    if (onlyUnpaid) result = result.filter((r) => r.status === 'unpaid' || r.status === 'partial')
    if (companyId) result = result.filter((r) => r.company_id === companyId)
    if (serviceId) result = result.filter((r) => r.service_id === serviceId)
    if (ownerId) result = result.filter((r) => r.owner_id === ownerId)
    if (collectorId) result = result.filter((r) => r.collector_id === collectorId)
    if (statusFilter) result = result.filter((r) => r.status === statusFilter)

    const sorted = [...result].sort((a, b) => {
      let cmp = 0
      if (sortMode === 'name') cmp = a.subscriber_name.localeCompare(b.subscriber_name)
      else if (sortMode === 'due') cmp = a.amount_due - b.amount_due
      else if (sortMode === 'paid') cmp = a.amount_paid - b.amount_paid
      else if (sortMode === 'due_date') cmp = (a.due_date ?? '').localeCompare(b.due_date ?? '')
      else if (sortMode === 'collected') cmp = (a.collected_at ?? '').localeCompare(b.collected_at ?? '')
      return sortDesc ? -cmp : cmp
    })
    return sorted
  }, [rows, onlyUnpaid, companyId, serviceId, ownerId, collectorId, statusFilter, sortMode, sortDesc])

  function handleExport() {
    exportToExcel(
      `monthly-log-${month}`,
      visibleRows.map((r) => ({
        Subscriber: r.subscriber_name,
        Owner: r.owner_name ?? '',
        Collector: r.default_collector_name ?? '',
        Company: r.company_name ?? '',
        Service: r.service_name ?? '',
        'Amount Due': r.amount_due,
        'Amount Paid': r.amount_paid,
        Status: r.status,
        'Due Date': r.due_date ?? '',
        'Postponed To': r.postponed_to ?? '',
        'Collected On': r.collected_at ?? '',
      })),
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Monthly Log
        </h1>
        <div className="flex items-center gap-2">
          <input
            type="month"
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={inputClass}
          />
          <button onClick={handleExport} className={secondaryButtonClass}>
            Export to Excel
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className={cardClass}>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Collected (services)</p>
          <p className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {servicesTotal}
          </p>
        </div>
        <div className={cardClass}>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Sold (products)</p>
          <p className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {productsTotal}
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <select
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value)
            setServiceId('')
          }}
          className={inputClass}
        >
          <option value="">Any company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputClass}>
          <option value="">Any service</option>
          {filteredServices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass}>
          <option value="">Any owner</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select value={collectorId} onChange={(e) => setCollectorId(e.target.value)} className={inputClass}>
          <option value="">Any collector</option>
          {collectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass}>
          <option value="">Any status</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="postponed">Postponed</option>
          <option value="waived">Waived</option>
        </select>
        <div className="flex gap-2">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className={`${inputClass} flex-1`}
          >
            <option value="name">Sort: Name</option>
            <option value="due">Sort: Amount due</option>
            <option value="paid">Sort: Amount paid</option>
            <option value="due_date">Sort: Due date</option>
            <option value="collected">Sort: Collected date</option>
          </select>
          <button
            onClick={() => setSortDesc((v) => !v)}
            className={`${secondaryButtonClass} shrink-0 px-3`}
            title={sortDesc ? 'Descending' : 'Ascending'}
          >
            {sortDesc ? '↓' : '↑'}
          </button>
        </div>
      </div>

      <button
        onClick={() => setOnlyUnpaid((v) => !v)}
        className={`${onlyUnpaid ? primaryButtonClass : secondaryButtonClass} mb-4`}
      >
        {onlyUnpaid ? 'Showing unpaid/partial only' : 'Show unpaid/partial only'}
      </button>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-2">
        {visibleRows.map((row) => (
          <div key={row.subscriber_id} className={cardClass}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {row.subscriber_name}
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Owner: {row.owner_name ?? '—'} · Collector: {row.default_collector_name ?? '—'}
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {row.company_name ?? '—'} · {row.service_name ?? '—'}
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Due {row.amount_due} · Paid {row.amount_paid}
                </p>
                {row.collected_at && (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Collected on {row.collected_at}</p>
                )}
              </div>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass[row.status]}`}
              >
                {row.status}
              </span>
            </div>
          </div>
        ))}
        {!loading && visibleRows.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">
            No invoices for this month matching these filters.
          </p>
        )}
      </div>
    </div>
  )
}
