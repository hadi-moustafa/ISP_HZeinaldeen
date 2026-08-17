import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'
import { isAdmin } from '../lib/permissions'
import { generateMonthlyInvoices, postponeInvoice, createPeriodInvoice } from '../lib/api/invoices'
import {
  getDashboardSummary,
  getExpiryWatch,
  getExpiringSubscribers,
  getCollectionTotal,
  getCollectionTodayTotal,
  getCollectionTodaySubscribers,
  getCompanyPaymentsDue,
  listMonthlyLog,
  type DashboardSummary,
  type ExpiryBucket,
  type CollectionRangeTotal,
  type CollectedSubscriber,
  type CompanyDueRow,
} from '../lib/api/reports'
import { listSubscribers, type SubscriberSearchField } from '../lib/api/subscribers'
import { listServices } from '../lib/api/services'
import { listCollectors } from '../lib/api/collectors'
import { listOwners } from '../lib/api/owners'
import { listCompanies } from '../lib/api/companies'
import { listAddresses } from '../lib/api/addresses'
import { emptyFilters } from '../types/subscribers'
import type { SubscriberWithRelations } from '../types/subscribers'
import type { ServiceWithCompany, Owner, Company, Address } from '../types/reference'
import type { Collector } from '../types/reference'
import type { MonthlyLogRow } from '../types/reports'
import { FILTER_FIELDS, TEXT_FILTER_FIELDS, type FilterField } from '../lib/subscriberFilterFields'
import { AppHeader } from '../components/AppHeader'
import { PaymentModal } from '../components/subscriber/PaymentModal'
import { primaryButtonClass, cardClass } from '../lib/uiClasses'
import { Search, Banknote, Pencil, Clock, ChevronDown } from 'lucide-react'

function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function currentMonthLabel() {
  return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function statusDotColor(log: MonthlyLogRow | undefined, debt: number): string {
  if (log?.status === 'partial') return 'bg-orange-500'
  if (debt > 0) return 'bg-red-500'
  if (log?.status === 'paid' || log?.status === 'waived') return 'bg-emerald-500'
  if (log?.status === 'postponed') return 'bg-orange-500'
  return 'bg-neutral-300'
}

// Today / +2 days / +5 days always render in this fixed red-amber-gray
// order -- matches the "how urgent" reading left-to-right, independent of
// bucket index.
const BUCKET_DOT_COLORS = ['bg-red-500', 'bg-amber-500', 'bg-neutral-400']

function ForecastCard({ title, headerRight, children }: { title: string; headerRight?: ReactNode; children: ReactNode }) {
  return (
    <div className={`${cardClass} mb-4 rounded-2xl`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-4.5 w-1 shrink-0 rounded-full bg-teal-600" />
          <h2 className="text-[13px] font-extrabold tracking-tight text-neutral-900">{title}</h2>
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  )
}

function ForecastTile({
  color,
  label,
  count,
  amount,
  breakdown,
}: {
  color: string
  label: string
  count: number
  amount: number
  breakdown?: { label: string; value: number }[]
}) {
  return (
    <div className="min-w-0 rounded-xl bg-neutral-50 px-2.5 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
        <span className="truncate text-[9.5px] font-bold uppercase tracking-wide text-neutral-500">{label}</span>
      </div>
      <p className="text-[17px] font-extrabold text-neutral-900 tabular-nums">
        {count} <span className="text-[10.5px] font-semibold text-neutral-400">· ${amount.toFixed(0)}</span>
      </p>
      {breakdown && breakdown.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {breakdown.map((b) => (
            <p key={b.label} className="truncate text-[10px] font-semibold text-neutral-400 tabular-nums">
              {b.label} · {b.value}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export function DashboardPage() {
  const { staff } = useStaff()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [expiryWatch, setExpiryWatch] = useState<ExpiryBucket[] | null>(null)
  const [collectedDays, setCollectedDays] = useState(5)
  const [collectionToday, setCollectionToday] = useState<CollectionRangeTotal | null>(null)
  const [collectionTotal, setCollectionTotal] = useState<CollectionRangeTotal | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)

  const [filters, setFilters] = useState(emptyFilters)
  const [filterField, setFilterField] = useState<FilterField>('name')
  const [filterFieldMenuOpen, setFilterFieldMenuOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<SubscriberWithRelations[]>([])
  const [searching, setSearching] = useState(false)

  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [owners, setOwners] = useState<Owner[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [addresses, setAddresses] = useState<Address[]>([])
  const [monthlyLogBySubscriber, setMonthlyLogBySubscriber] = useState<Record<string, MonthlyLogRow>>({})

  const [paymentSub, setPaymentSub] = useState<SubscriberWithRelations | null>(null)
  const [postponingId, setPostponingId] = useState<string | null>(null)
  const [expiringDays, setExpiringDays] = useState(5)
  const [expiringList, setExpiringList] = useState<SubscriberWithRelations[]>([])
  const [companyDueDays, setCompanyDueDays] = useState(5)
  const [companyDueRows, setCompanyDueRows] = useState<CompanyDueRow[] | null>(null)
  const [collectedTodayOpen, setCollectedTodayOpen] = useState(false)
  const [collectedTodayNames, setCollectedTodayNames] = useState<CollectedSubscriber[] | null>(null)
  const [collectedTodayLoading, setCollectedTodayLoading] = useState(false)

  function refreshStats() {
    getDashboardSummary(currentPeriodMonth())
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
    getExpiryWatch()
      .then(setExpiryWatch)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load expiry watch'))
    getCollectionTodayTotal()
      .then(setCollectionToday)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load today\'s collected total'))
    getCollectionTotal(collectedDays)
      .then(setCollectionTotal)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load collected total'))
    getExpiringSubscribers(expiringDays)
      .then(setExpiringList)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load expiring subscribers'))
    getCompanyPaymentsDue(companyDueDays)
      .then(setCompanyDueRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load company payments due'))
    setCollectedTodayNames(null)
    listMonthlyLog(currentPeriodMonth())
      .then((rows) => setMonthlyLogBySubscriber(Object.fromEntries(rows.map((row) => [row.subscriber_id, row]))))
      .catch(() => {})
  }

  useEffect(() => {
    refreshStats()
    listServices().then(setServices).catch(() => {})
    listCollectors().then(setCollectors).catch(() => {})
    listOwners().then(setOwners).catch(() => {})
    listCompanies().then(setCompanies).catch(() => {})
    listAddresses().then(setAddresses).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    getCollectionTotal(collectedDays)
      .then(setCollectionTotal)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load collected total'))
  }, [collectedDays])

  useEffect(() => {
    getExpiringSubscribers(expiringDays)
      .then(setExpiringList)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load expiring subscribers'))
  }, [expiringDays])

  useEffect(() => {
    getCompanyPaymentsDue(companyDueDays)
      .then(setCompanyDueRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load company payments due'))
  }, [companyDueDays])

  async function toggleCollectedToday() {
    if (!collectedTodayOpen && collectedTodayNames === null) {
      setCollectedTodayLoading(true)
      try {
        setCollectedTodayNames(await getCollectionTodaySubscribers())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load today\'s collections')
      } finally {
        setCollectedTodayLoading(false)
      }
    }
    setCollectedTodayOpen((v) => !v)
  }

  const filteredServices = useMemo(
    () => (filters.companyId ? services.filter((s) => s.comp_id === filters.companyId) : services),
    [services, filters.companyId],
  )

  // Mirrors the subscriber list's own filter -> query wiring exactly (same
  // company->service scoping, same owner-name resolution, same client-side
  // id-substring filter for the uuid ilike limitation) so "search like the
  // subscriber list" means the identical set of results, not a re-derived
  // approximation.
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => {
    if (key === 'debtMode') return value !== 'any'
    return value !== ''
  }).length

  useEffect(() => {
    if (activeFilterCount === 0) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false

    const serviceIdsForCompany =
      filters.companyId && !filters.serviceId
        ? services.filter((s) => s.comp_id === filters.companyId).map((s) => s.id)
        : null

    const ownerIdsForSearch =
      filterField === 'owner' && filters.search.trim()
        ? owners.filter((o) => o.name.toLowerCase().includes(filters.search.trim().toLowerCase())).map((o) => o.id)
        : null

    const apiSearchField: SubscriberSearchField =
      filterField === 'id' || filterField === 'owner' || filterField === 'username' ? filterField : 'name'

    const timer = setTimeout(() => {
      listSubscribers(filters, serviceIdsForCompany, apiSearchField, ownerIdsForSearch)
        .then((rows) => {
          if (cancelled) return
          let result = rows
          if (filterField === 'id' && filters.search.trim()) {
            const term = filters.search.trim().toLowerCase()
            result = result.filter((r) => r.id.toLowerCase().includes(term))
          }
          setSearchResults(result)
        })
        .catch(() => {
          if (!cancelled) setSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, filterField, services, owners])

  function updateFilter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function selectFilterField(field: FilterField) {
    setFilterField(field)
    setFilterFieldMenuOpen(false)
    setFilters(emptyFilters)
  }

  async function handleGenerateInvoices() {
    setGenerating(true)
    setGenerateResult(null)
    try {
      const result = await generateMonthlyInvoices()
      setGenerateResult(`Created ${result.created}, skipped ${result.skipped}.`)
      refreshStats()
    } catch (err) {
      setGenerateResult(err instanceof Error ? err.message : 'Failed to generate invoices')
    } finally {
      setGenerating(false)
    }
  }

  // Quick postpone -- days-from-now rather than an absolute date, per
  // explicit ask ("how much will this user be postponed... make it in
  // days"). Creates the current period's invoice on demand first if one
  // doesn't exist yet (same on-demand pattern PaymentModal uses), since
  // postpone_invoice needs a real invoice row to act on.
  async function handleQuickPostpone(sub: SubscriberWithRelations) {
    const daysStr = window.prompt(`Postpone ${sub.name}'s payment by how many days?`)
    if (!daysStr) return
    const days = Number(daysStr)
    if (!Number.isFinite(days) || days <= 0) {
      window.alert('Enter a whole number of days greater than 0.')
      return
    }
    setPostponingId(sub.id)
    try {
      let log: MonthlyLogRow | undefined = monthlyLogBySubscriber[sub.id]
      if (!log && sub.service_id) {
        const period = currentPeriodMonth()
        await createPeriodInvoice(sub.id, sub.service_id, period)
        const rows = await listMonthlyLog(period)
        setMonthlyLogBySubscriber(Object.fromEntries(rows.map((row) => [row.subscriber_id, row])))
        log = rows.find((row) => row.subscriber_id === sub.id)
      }
      if (!log?.invoice_id) {
        window.alert('This subscriber has no billable invoice to postpone.')
        return
      }
      // Local getters/setters throughout -- never toISOString() for a
      // date-only value, since it converts to UTC first and silently rolls
      // the date back a day anywhere east of UTC (the same class of bug
      // the Excel importer hit; see formatDateLocal in lib/api/import.ts).
      const base = log.due_date ? new Date(`${log.due_date}T00:00:00`) : new Date()
      base.setDate(base.getDate() + days)
      const y = base.getFullYear()
      const m = String(base.getMonth() + 1).padStart(2, '0')
      const d = String(base.getDate()).padStart(2, '0')
      const newDueDate = `${y}-${m}-${d}`
      await postponeInvoice(log.invoice_id, newDueDate, `Postponed ${days} day(s) from the dashboard`, staff?.id ?? null)
      refreshStats()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to postpone')
    } finally {
      setPostponingId(null)
    }
  }

  function SubscriberRow({ sub, showActions = false }: { sub: SubscriberWithRelations; showActions?: boolean }) {
    const log = monthlyLogBySubscriber[sub.id]
    return (
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(log, sub.debt)}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">{sub.name}</p>
          <p className="truncate text-xs text-neutral-500">
            {sub.services?.companies?.name ?? '—'}
            {sub.expiry_date ? ` · exp ${new Date(sub.expiry_date + 'T00:00:00').getUTCDate()}` : ''}
          </p>
        </div>
        {showActions && (
          <>
            <Link
              to={`/subscribers/${sub.id}/edit`}
              title="Edit subscriber"
              className="flex shrink-0 items-center justify-center rounded-full bg-neutral-100 p-2 text-neutral-600"
            >
              <Pencil size={14} />
            </Link>
            <button
              onClick={() => handleQuickPostpone(sub)}
              disabled={postponingId === sub.id}
              title="Postpone payment"
              className="flex shrink-0 items-center justify-center rounded-full bg-amber-100 p-2 text-amber-700 disabled:opacity-50"
            >
              <Clock size={14} />
            </button>
          </>
        )}
        <button
          onClick={() => setPaymentSub(sub)}
          title="Log a payment"
          className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Banknote size={14} />
          Pay
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader>
        <main className="p-3">
          <div className="mb-3 flex items-center gap-3">
            <div className="min-w-0 shrink-0">
              <h1 className="text-lg font-semibold text-neutral-900">Dashboard</h1>
              <p className="text-sm text-neutral-500">{currentMonthLabel()}</p>
            </div>

            <div className="relative ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5">
              <button
                onClick={() => setFilterFieldMenuOpen((v) => !v)}
                className="flex shrink-0 items-center gap-0.5 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-neutral-700 shadow-sm"
              >
                {FILTER_FIELDS.find((f) => f.value === filterField)?.label}
                <ChevronDown size={12} className="text-neutral-400" />
              </button>

              {TEXT_FILTER_FIELDS.includes(filterField) && (
                <div className="flex max-w-32 flex-1 items-center rounded-full bg-white px-2 shadow-sm">
                  <Search size={12} className="mr-1 shrink-0 text-neutral-400" />
                  <input
                    value={filterField === 'phone' ? filters.phone : filterField === 'notes' ? filters.notes : filters.search}
                    onChange={(e) => {
                      const value = e.target.value
                      if (filterField === 'phone') updateFilter('phone', value)
                      else if (filterField === 'notes') updateFilter('notes', value)
                      else updateFilter('search', value)
                    }}
                    placeholder="Search…"
                    className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-neutral-900 outline-none"
                  />
                </div>
              )}

              {filterField === 'collector' && (
                <select
                  value={filters.collectorId}
                  onChange={(e) => updateFilter('collectorId', e.target.value)}
                  className="max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
                >
                  <option value="">Any collector</option>
                  {collectors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              {filterField === 'company' && (
                <select
                  value={filters.companyId}
                  onChange={(e) => {
                    updateFilter('companyId', e.target.value)
                    updateFilter('serviceId', '')
                  }}
                  className="max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
                >
                  <option value="">Any company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              {filterField === 'service' && (
                <select
                  value={filters.serviceId}
                  onChange={(e) => updateFilter('serviceId', e.target.value)}
                  className="max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
                >
                  <option value="">Any service</option>
                  {filteredServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}

              {filterField === 'address' && (
                <select
                  value={filters.addressId}
                  onChange={(e) => updateFilter('addressId', e.target.value)}
                  className="max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
                >
                  <option value="">Any address</option>
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}

              {filterField === 'nationality' && (
                <select
                  value={filters.nationality}
                  onChange={(e) => updateFilter('nationality', e.target.value as typeof filters.nationality)}
                  className="max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
                >
                  <option value="">Any nationality</option>
                  <option value="Lebanese">Lebanese</option>
                  <option value="Syrian">Syrian</option>
                </select>
              )}

              {filterField === 'status' && (
                <select
                  value={filters.status}
                  onChange={(e) => updateFilter('status', e.target.value as typeof filters.status)}
                  className="max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
                >
                  <option value="">Any status</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              )}

              {filterField === 'expiry' && (
                <div className="flex max-w-40 flex-1 gap-1">
                  <input
                    type="date"
                    value={filters.expiryFrom}
                    onChange={(e) => updateFilter('expiryFrom', e.target.value)}
                    className="min-w-0 flex-1 rounded-full bg-white px-2 py-1 text-xs text-neutral-900 shadow-sm"
                  />
                  <input
                    type="date"
                    value={filters.expiryTo}
                    onChange={(e) => updateFilter('expiryTo', e.target.value)}
                    className="min-w-0 flex-1 rounded-full bg-white px-2 py-1 text-xs text-neutral-900 shadow-sm"
                  />
                </div>
              )}

              {filterField === 'connection' && (
                <div className="flex max-w-40 flex-1 gap-1">
                  <input
                    type="date"
                    value={filters.connectionFrom}
                    onChange={(e) => updateFilter('connectionFrom', e.target.value)}
                    className="min-w-0 flex-1 rounded-full bg-white px-2 py-1 text-xs text-neutral-900 shadow-sm"
                  />
                  <input
                    type="date"
                    value={filters.connectionTo}
                    onChange={(e) => updateFilter('connectionTo', e.target.value)}
                    className="min-w-0 flex-1 rounded-full bg-white px-2 py-1 text-xs text-neutral-900 shadow-sm"
                  />
                </div>
              )}

              {/* Rendered outside any overflow-hidden container -- an ancestor's
                  overflow-hidden clips absolutely-positioned descendants
                  regardless of z-index (bit us once on the subscriber list). */}
              {filterFieldMenuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-40 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
                  {FILTER_FIELDS.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => selectFilterField(f.value)}
                      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50 ${
                        f.value === filterField ? 'font-semibold text-indigo-600' : 'text-neutral-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          {activeFilterCount > 0 && (
            <div className="mb-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-400">
                  {searching ? 'Searching…' : `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'}`}
                </p>
                <button onClick={() => setFilters(emptyFilters)} className="text-xs font-medium text-neutral-500">
                  Clear
                </button>
              </div>
              {!searching && searchResults.length === 0 && (
                <p className="text-xs text-neutral-400">No subscribers match.</p>
              )}
              {searchResults.map((sub) => (
                <SubscriberRow key={sub.id} sub={sub} showActions />
              ))}
            </div>
          )}

          {summary && (
            <>
              {/* Hero: % collected ring + collected/left split */}
              <div className={`${cardClass} mb-3 rounded-2xl`}>
                <div className="mb-4 flex items-center gap-4">
                  <div
                    className="relative grid h-20 w-20 shrink-0 place-items-center rounded-full"
                    style={{
                      background: `conic-gradient(#059669 ${
                        summary.totalDue > 0
                          ? Math.min(100, (summary.totalPaymentsCollected / summary.totalDue) * 100)
                          : 0
                      }%, #f5f5f5 0)`,
                    }}
                  >
                    <div className="absolute inset-[7px] rounded-full bg-white" />
                    <p className="relative text-center text-sm font-extrabold text-neutral-900">
                      {summary.totalDue > 0 ? Math.round((summary.totalPaymentsCollected / summary.totalDue) * 100) : 0}%
                      <span className="block text-[8.5px] font-bold uppercase tracking-wide text-neutral-400">collected</span>
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-2xl font-extrabold tracking-tight text-neutral-900 tabular-nums">
                      {summary.totalDue.toFixed(0)}
                      <span className="ml-1 text-sm font-semibold text-neutral-400">total this period</span>
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl bg-emerald-50 px-3 py-2.5">
                    <p className="text-base font-extrabold text-emerald-600 tabular-nums">
                      {summary.totalPaymentsCollected.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-neutral-500 tabular-nums">
                      Svc {summary.totalPaid.toFixed(2)} · Prod {summary.totalPaymentsProducts.toFixed(2)}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-neutral-500">Collected</p>
                  </div>
                  <div className="rounded-xl bg-rose-50 px-3 py-2.5">
                    <p className="text-base font-extrabold text-rose-600 tabular-nums">
                      {(summary.totalLeft + summary.totalLeftProducts).toFixed(2)}
                    </p>
                    <p className="text-[10px] text-neutral-500 tabular-nums">
                      Svc {summary.totalLeft.toFixed(2)} · Prod {summary.totalLeftProducts.toFixed(2)}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-neutral-500">Left to collect</p>
                  </div>
                </div>
              </div>

              {/* Subscribers / paid / unpaid, with progress bars */}
              <div className="mb-3 grid grid-cols-3 gap-2">
                <div className={`${cardClass} rounded-2xl text-center`}>
                  <p className="text-lg font-extrabold text-neutral-900 tabular-nums">{summary.totalSubscribers}</p>
                  <p className="text-[10.5px] text-neutral-500">Subscribers</p>
                </div>
                <div className={`${cardClass} rounded-2xl text-center`}>
                  <p className="text-lg font-extrabold text-emerald-600 tabular-nums">{summary.paidUsers}</p>
                  <p className="text-[10.5px] text-neutral-500">Paid</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{
                        width: `${
                          summary.totalSubscribers > 0 ? (summary.paidUsers / summary.totalSubscribers) * 100 : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div className={`${cardClass} rounded-2xl text-center`}>
                  <p className="text-lg font-extrabold text-red-600 tabular-nums">{summary.unpaidUsers}</p>
                  <p className="text-[10.5px] text-neutral-500">Unpaid</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-red-500"
                      style={{
                        width: `${
                          summary.totalSubscribers > 0 ? (summary.unpaidUsers / summary.totalSubscribers) * 100 : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Products: sold count + total payments, one banded row */}
              <div className={`${cardClass} mb-4 flex items-center gap-3.5 rounded-2xl`}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-teal-50 text-teal-600">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 8v13H3V8" />
                    <path d="M1 3h22v5H1z" />
                    <path d="M10 12h4" />
                  </svg>
                </div>
                <div className="flex flex-1 gap-5">
                  <div>
                    <p className="text-base font-extrabold text-neutral-900 tabular-nums">{summary.totalSoldProducts}</p>
                    <p className="text-[10.5px] text-neutral-500">units sold</p>
                  </div>
                  <div>
                    <p className="text-base font-extrabold text-emerald-600 tabular-nums">
                      {summary.totalPaymentsProducts.toFixed(2)}
                    </p>
                    <p className="text-[10.5px] text-neutral-500">collected for them</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {!summary && !error && <p className="mb-3 text-sm text-neutral-500">Loading…</p>}

          {/* Collected -- today, plus a cumulative total over an admin-selectable day range */}
          {collectionToday && collectionTotal && (
            <ForecastCard
              title="Collected"
              headerRight={
                <select
                  value={collectedDays}
                  onChange={(e) => setCollectedDays(Number(e.target.value))}
                  className="shrink-0 rounded-full bg-neutral-50 px-2 py-1 text-xs text-neutral-700"
                >
                  {[5, 10, 15, 20, 25, 30].map((d) => (
                    <option key={d} value={d}>
                      Last {d} days
                    </option>
                  ))}
                </select>
              }
            >
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl bg-neutral-50 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xl font-extrabold text-emerald-600 tabular-nums">
                      {collectionToday.count}{' '}
                      <span className="text-[11.5px] font-semibold text-neutral-400">
                        · ${collectionToday.amount.toFixed(0)}
                      </span>
                    </p>
                    <button
                      onClick={toggleCollectedToday}
                      aria-expanded={collectedTodayOpen}
                      aria-label={collectedTodayOpen ? 'Hide names' : 'Show names'}
                      className="flex shrink-0 items-center justify-center rounded-full bg-white p-1 text-neutral-400 shadow-sm"
                    >
                      <ChevronDown
                        size={13}
                        className={`transition-transform duration-200 ${collectedTodayOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>
                  <p className="mt-0.5 text-[11px] text-neutral-500">subscribers collected today</p>
                </div>
                <div className="rounded-xl bg-neutral-50 px-3.5 py-3">
                  <p className="text-xl font-extrabold text-emerald-600 tabular-nums">
                    {collectionTotal.count}{' '}
                    <span className="text-[11.5px] font-semibold text-neutral-400">· ${collectionTotal.amount.toFixed(0)}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    in the last {collectionTotal.days} day{collectionTotal.days > 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              {collectedTodayOpen && (
                <div className="mt-2.5 space-y-1 rounded-xl bg-neutral-50 px-3.5 py-2.5">
                  {collectedTodayLoading && <p className="text-xs text-neutral-400">Loading…</p>}
                  {!collectedTodayLoading && collectedTodayNames?.length === 0 && (
                    <p className="text-xs text-neutral-400">Nobody collected from yet today.</p>
                  )}
                  {!collectedTodayLoading &&
                    collectedTodayNames?.map((c) => (
                      <div key={c.subscriberId} className="flex items-center justify-between text-sm">
                        <span className="truncate text-neutral-700">{c.name}</span>
                        <span className="shrink-0 font-semibold text-neutral-900 tabular-nums">
                          ${c.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </ForecastCard>
          )}

          {/* Expiring soon -- who to go collect from. */}
          {expiryWatch && (
            <ForecastCard
              title="Expiring soon"
              headerRight={
                <select
                  value={expiringDays}
                  onChange={(e) => setExpiringDays(Number(e.target.value))}
                  className="shrink-0 rounded-full bg-neutral-50 px-2 py-1 text-xs text-neutral-700"
                >
                  {[5, 10, 20, 30].map((d) => (
                    <option key={d} value={d}>
                      Next {d} days
                    </option>
                  ))}
                </select>
              }
            >
              <div className="mb-3 grid grid-cols-3 gap-2">
                {expiryWatch.map((bucket, i) => (
                  <ForecastTile
                    key={bucket.date}
                    color={BUCKET_DOT_COLORS[i]}
                    label={bucket.label}
                    count={bucket.subscribers.length}
                    amount={bucket.subscribers.reduce((sum, sub) => sum + (sub.services?.sell_price ?? 0), 0)}
                    breakdown={
                      i === 0
                        ? bucket.companyTotals.map((ct) => ({ label: ct.companyName, value: ct.count }))
                        : undefined
                    }
                  />
                ))}
              </div>

              <div className="rounded-xl bg-neutral-50 px-3.5 py-3">
                <p className="text-xl font-extrabold text-neutral-900 tabular-nums">
                  {expiringList.length}{' '}
                  <span className="text-[11.5px] font-semibold text-neutral-400">
                    · ${expiringList.reduce((sum, sub) => sum + (sub.services?.sell_price ?? 0), 0).toFixed(0)}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-500">expiring in the next {expiringDays} days</p>
              </div>
            </ForecastCard>
          )}

          {/* Per-company payment alerts, table form -- adapts to however
              many companies actually have subscribers due, and to any
              admin-selected day range. */}
          {companyDueRows && (
            <ForecastCard
              title="Company payments due"
              headerRight={
                <div className="flex shrink-0 items-center gap-1.5">
                  <select
                    value={companyDueDays}
                    onChange={(e) => setCompanyDueDays(Number(e.target.value))}
                    className="rounded-full bg-neutral-50 px-2 py-1 text-xs text-neutral-700"
                  >
                    {[5, 10, 20, 30].map((d) => (
                      <option key={d} value={d}>
                        Next {d} days
                      </option>
                    ))}
                  </select>
                  <Link to="/admin/company-payments/analysis" className="text-xs font-medium text-blue-600">
                    Full analysis →
                  </Link>
                </div>
              }
            >
              {companyDueRows.length === 0 ? (
                <p className="text-xs text-neutral-400">No company payments due in the next {companyDueDays} days.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-neutral-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-neutral-50 text-left text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">
                        <th className="px-3 py-2 font-bold">Company</th>
                        <th className="px-3 py-2 text-right font-bold">Users</th>
                        <th className="px-3 py-2 text-right font-bold">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {companyDueRows.map((row) => (
                        <tr key={row.companyName}>
                          <td className="truncate px-3 py-2 font-medium text-neutral-800">{row.companyName}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{row.count}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">
                            {row.amount.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-neutral-200 bg-neutral-50">
                        <td className="px-3 py-2 font-bold text-neutral-700">Total</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-neutral-700">
                          {companyDueRows.reduce((sum, r) => sum + r.count, 0)}
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-neutral-900">
                          {companyDueRows.reduce((sum, r) => sum + r.amount, 0).toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </ForecastCard>
          )}

          {isAdmin(staff) && (
            <div className={cardClass}>
              <p className="mb-2 text-sm text-neutral-500">
                Invoices generate automatically on the 1st of each month. Use this to backfill or
                re-run for the current month.
              </p>
              <button onClick={handleGenerateInvoices} disabled={generating} className={primaryButtonClass}>
                {generating ? 'Generating…' : "Generate this month's invoices"}
              </button>
              {generateResult && <p className="mt-2 text-sm text-neutral-600">{generateResult}</p>}
            </div>
          )}
        </main>
      </AppHeader>

      <PaymentModal
        subscriber={paymentSub}
        onClose={() => setPaymentSub(null)}
        onChanged={refreshStats}
        services={services}
        collectors={collectors}
        monthlyLog={paymentSub ? monthlyLogBySubscriber[paymentSub.id] : undefined}
      />
    </div>
  )
}
