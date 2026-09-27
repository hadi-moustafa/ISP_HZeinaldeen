import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'
import { isAdmin } from '../lib/permissions'
import { generateMonthlyInvoices, getLatestGenerationRun, type InvoiceGenerationRun } from '../lib/api/invoices'
import {
  getDashboardSummary,
  getCollectionTotal,
  getCollectionTodayTotal,
  getCollectionTodaySubscribers,
  getCompanyPaymentsDue,
  listMonthlyLog,
  type DashboardSummary,
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
import { useLocalStorageState } from '../lib/useLocalStorageState'
import type { SubscriberWithRelations } from '../types/subscribers'
import type { ServiceWithCompany, Owner, Company, Address } from '../types/reference'
import type { Collector } from '../types/reference'
import type { MonthlyLogRow } from '../types/reports'
import { FILTER_FIELDS, TEXT_FILTER_FIELDS, type FilterField } from '../lib/subscriberFilterFields'
import { AppHeader } from '../components/AppHeader'
import { PaymentModal } from '../components/subscriber/PaymentModal'
import { SubscriberRow } from '../components/subscriber/SubscriberRow'
import { currentPeriodMonth, compareByExpiryDay, quickPostpone, billingKeyFor } from '../lib/subscriberRowHelpers'
import { primaryButtonClass, cardClass } from '../lib/uiClasses'
import { Search, ChevronDown, AlertTriangle } from 'lucide-react'

function currentMonthLabel() {
  return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

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

export function DashboardPage() {
  const { staff } = useStaff()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [collectedDays, setCollectedDays] = useState(5)
  const [collectionToday, setCollectionToday] = useState<CollectionRangeTotal | null>(null)
  const [collectionTotal, setCollectionTotal] = useState<CollectionRangeTotal | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<InvoiceGenerationRun | null>(null)

  // Search/filter/Paid-Unpaid survive closing the browser (localStorage);
  // only the Clear button resets them.
  const [filters, setFilters] = useLocalStorageState('isp:dashboard-filters:filters', emptyFilters)
  const [filterField, setFilterField] = useLocalStorageState<FilterField>('isp:dashboard-filters:field', 'name')
  const [filterFieldMenuOpen, setFilterFieldMenuOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<SubscriberWithRelations[]>([])
  // Paid / Unpaid toggle, applied on top of whatever search/filter is set.
  // On its own (no search or filter) it lists everyone paid / unpaid.
  const [paidFilter, setPaidFilter] = useLocalStorageState<'any' | 'paid' | 'unpaid'>('isp:dashboard-filters:paid', 'any')
  const [searching, setSearching] = useState(false)

  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [owners, setOwners] = useState<Owner[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [addresses, setAddresses] = useState<Address[]>([])
  const [monthlyLogBySubscriber, setMonthlyLogBySubscriber] = useState<Record<string, MonthlyLogRow>>({})

  const [paymentSub, setPaymentSub] = useState<SubscriberWithRelations | null>(null)
  const [postponingId, setPostponingId] = useState<string | null>(null)
  const [companyDueDays, setCompanyDueDays] = useState(5)
  const [companyDueRows, setCompanyDueRows] = useState<CompanyDueRow[] | null>(null)
  const [collectedTodayOpen, setCollectedTodayOpen] = useState(false)
  const [collectedTodayNames, setCollectedTodayNames] = useState<CollectedSubscriber[] | null>(null)
  const [collectedTodayLoading, setCollectedTodayLoading] = useState(false)

  function refreshStats() {
    getDashboardSummary()
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
    getCollectionTodayTotal()
      .then(setCollectionToday)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load today\'s collected total'))
    getCollectionTotal(collectedDays)
      .then(setCollectionTotal)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load collected total'))
    getCompanyPaymentsDue(companyDueDays)
      .then(setCompanyDueRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load company payments due'))
    setCollectedTodayNames(null)
    getLatestGenerationRun().then(setLastRun).catch(() => {})
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

  const searchActive = activeFilterCount > 0 || paidFilter !== 'any'

  // Same meaning as the dashboard's Paid / Not paid yet tiles: paid = this
  // month's bill paid or forgiven (the green dot); unpaid = an active
  // subscriber with a service who hasn't paid yet (suspended/cancelled
  // subscribers aren't billed, so they're never "unpaid").
  const displayedResults = useMemo(() => {
    if (paidFilter === 'any') return searchResults
    return searchResults.filter((sub) => {
      const paid = billingKeyFor(monthlyLogBySubscriber[sub.id], sub.debt) === 'paid'
      if (paidFilter === 'paid') return paid
      return !paid && sub.connection_status === 'active' && Boolean(sub.service_id)
    })
  }, [searchResults, paidFilter, monthlyLogBySubscriber])

  useEffect(() => {
    if (!searchActive) {
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
          setSearchResults([...result].sort(compareByExpiryDay))
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
  }, [filters, filterField, services, owners, searchActive])

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
      setGenerateResult(
        `Created ${result.created}, ${result.skipped} already billed` +
          (result.failed > 0 ? `, ${result.failed} failed: ${result.errors.map((e) => `${e.subscriber} (${e.error})`).join('; ')}` : '.'),
      )
      refreshStats()
    } catch (err) {
      setGenerateResult(err instanceof Error ? err.message : 'Failed to generate invoices')
    } finally {
      setGenerating(false)
    }
  }

  async function handleQuickPostpone(sub: SubscriberWithRelations) {
    setPostponingId(sub.id)
    try {
      if (await quickPostpone(sub, monthlyLogBySubscriber[sub.id], staff?.id ?? null, 'dashboard')) refreshStats()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to postpone')
    } finally {
      setPostponingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader>
        <main className="p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="min-w-0 shrink-0">
              <h1 className="text-lg font-semibold text-neutral-900">Dashboard</h1>
              <p className="text-xs text-neutral-500">{currentMonthLabel()}</p>
            </div>

            {/* Paid / Unpaid toggle -- narrows the search/filter results
                beside it, or on its own lists everyone paid / unpaid. */}
            <div className="flex shrink-0 rounded-full bg-white p-0.5 shadow-sm">
              {(
                [
                  ['any', 'All', 'bg-neutral-900 text-white'],
                  ['paid', 'Paid', 'bg-emerald-500 text-white'],
                  ['unpaid', 'Unpaid', 'bg-red-500 text-white'],
                ] as const
              ).map(([value, label, activeClass]) => (
                <button
                  key={value}
                  onClick={() => setPaidFilter(value)}
                  aria-pressed={paidFilter === value}
                  className={`rounded-full px-1.5 py-1 text-[11px] font-semibold ${
                    paidFilter === value ? activeClass : 'text-neutral-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative ml-auto flex min-w-[128px] flex-1 items-center justify-end gap-1.5">
              <button
                onClick={() => setFilterFieldMenuOpen((v) => !v)}
                className="flex shrink-0 items-center gap-0.5 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-neutral-700 shadow-sm"
              >
                {FILTER_FIELDS.find((f) => f.value === filterField)?.label}
                <ChevronDown size={12} className="text-neutral-400" />
              </button>

              {TEXT_FILTER_FIELDS.includes(filterField) && (
                <div className="flex min-w-0 max-w-32 flex-1 items-center rounded-full bg-white px-2 shadow-sm">
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
                  className="min-w-0 max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
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
                  className="min-w-0 max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
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
                  className="min-w-0 max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
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
                  className="min-w-0 max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
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
                  className="min-w-0 max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
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
                  className="min-w-0 max-w-32 flex-1 rounded-full bg-white px-2 py-1.5 text-xs text-neutral-900 shadow-sm"
                >
                  <option value="">Any status</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              )}

              {filterField === 'expiry' && (
                <div className="flex min-w-0 max-w-40 flex-1 gap-1">
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
                <div className="flex min-w-0 max-w-40 flex-1 gap-1">
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

          {searchActive && (
            <div className="mb-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-400">
                  {searching
                    ? 'Searching…'
                    : `${displayedResults.length} ${paidFilter === 'any' ? '' : `${paidFilter} `}match${
                        displayedResults.length === 1 ? '' : 'es'
                      }`}
                </p>
                <button
                  onClick={() => {
                    setFilters(emptyFilters)
                    setFilterField('name')
                    setPaidFilter('any')
                  }}
                  className="text-xs font-medium text-neutral-500"
                >
                  Clear
                </button>
              </div>
              {!searching && displayedResults.length === 0 && (
                <p className="text-xs text-neutral-400">No subscribers match.</p>
              )}
              {displayedResults.map((sub) => (
                <SubscriberRow
                  key={sub.id}
                  sub={sub}
                  log={monthlyLogBySubscriber[sub.id]}
                  onPay={setPaymentSub}
                  onPostpone={handleQuickPostpone}
                  postponing={postponingId === sub.id}
                />
              ))}
            </div>
          )}

          {summary && (
            <>
              {/* Hero: how much of this month's bills is paid. Money received
                  this month by date (old debt, advance payments) is the
                  separate "Collected" card further down. */}
              {(() => {
                const pct =
                  summary.periodDue > 0
                    ? Math.min(100, ((summary.periodPaid + summary.periodForgiven) / summary.periodDue) * 100)
                    : 0
                return (
                  <div className={`${cardClass} mb-3 rounded-2xl`}>
                    <div className="mb-4 flex items-center gap-4">
                      <div
                        className="relative grid h-20 w-20 shrink-0 place-items-center rounded-full"
                        style={{ background: `conic-gradient(#059669 ${pct}%, #f5f5f5 0)` }}
                      >
                        <div className="absolute inset-[7px] rounded-full bg-white" />
                        <p className="relative text-center text-sm font-extrabold text-neutral-900">
                          {Math.round(pct)}%
                          <span className="block text-[8.5px] font-bold uppercase tracking-wide text-neutral-400">
                            settled
                          </span>
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-2xl font-extrabold tracking-tight text-neutral-900 tabular-nums">
                          {summary.periodDue.toFixed(0)}
                          <span className="ml-1 text-sm font-semibold text-neutral-400">billed this month</span>
                        </p>
                        {summary.unbilledSubscribers > 0 && (
                          <p className="text-[11px] text-neutral-500">
                            incl. {summary.unbilledSubscribers} subscriber{summary.unbilledSubscribers > 1 ? 's' : ''} not
                            billed yet
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-xl bg-emerald-50 px-3 py-2.5">
                        <p className="text-base font-extrabold text-emerald-600 tabular-nums">
                          {summary.periodPaid.toFixed(2)}
                        </p>
                        {summary.periodForgiven > 0 && (
                          <p className="text-[10px] text-neutral-500 tabular-nums">
                            + {summary.periodForgiven.toFixed(2)} forgiven
                          </p>
                        )}
                        <p className="mt-1 text-[11px] font-medium text-neutral-500">Paid on this month's bills</p>
                      </div>
                      <div className="rounded-xl bg-rose-50 px-3 py-2.5">
                        <p className="text-base font-extrabold text-rose-600 tabular-nums">
                          {summary.periodLeft.toFixed(2)}
                        </p>
                        {summary.overdueSubscribers > 0 && (
                          <p className="text-[10px] text-neutral-500 tabular-nums">
                            {summary.overdueAmount.toFixed(2)} of it overdue
                          </p>
                        )}
                        <p className="mt-1 text-[11px] font-medium text-neutral-500">Left to collect</p>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Billed subscribers: paid / not paid yet / overdue */}
              <div className="mb-3 grid grid-cols-3 gap-2">
                <div className={`${cardClass} rounded-2xl text-center`}>
                  <p className="text-lg font-extrabold text-neutral-900 tabular-nums">{summary.billableSubscribers}</p>
                  <p className="text-[10.5px] text-neutral-500">Active subscribers</p>
                </div>
                <div className={`${cardClass} rounded-2xl text-center`}>
                  <p className="text-lg font-extrabold text-emerald-600 tabular-nums">{summary.paidUsers}</p>
                  <p className="text-[10.5px] text-neutral-500">Paid</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{
                        width: `${
                          summary.billableSubscribers > 0 ? (summary.paidUsers / summary.billableSubscribers) * 100 : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div className={`${cardClass} rounded-2xl text-center`}>
                  <p className="text-lg font-extrabold text-red-600 tabular-nums">{summary.unpaidUsers}</p>
                  <p className="text-[10.5px] text-neutral-500">
                    Not paid yet{summary.overdueSubscribers > 0 ? ` · ${summary.overdueSubscribers} overdue` : ''}
                  </p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-red-500"
                      style={{
                        width: `${
                          summary.billableSubscribers > 0 ? (summary.unpaidUsers / summary.billableSubscribers) * 100 : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Products sold this month: units, collected, still owed */}
              <div className={`${cardClass} mb-4 flex items-center gap-3.5 rounded-2xl`}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-teal-50 text-teal-600">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 8v13H3V8" />
                    <path d="M1 3h22v5H1z" />
                    <path d="M10 12h4" />
                  </svg>
                </div>
                <div className="flex flex-1 gap-4">
                  <div>
                    <p className="text-base font-extrabold text-neutral-900 tabular-nums">{summary.productUnits}</p>
                    <p className="text-[10.5px] text-neutral-500">units sold</p>
                  </div>
                  <div>
                    <p className="text-base font-extrabold text-emerald-600 tabular-nums">
                      {summary.productPaid.toFixed(2)}
                    </p>
                    <p className="text-[10.5px] text-neutral-500">collected</p>
                  </div>
                  <div>
                    <p className="text-base font-extrabold text-rose-600 tabular-nums">
                      {summary.productLeft.toFixed(2)}
                    </p>
                    <p className="text-[10.5px] text-neutral-500">still owed</p>
                  </div>
                </div>
                <Link
                  to="/admin/products?tab=sell"
                  className="shrink-0 rounded-full bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Sell →
                </Link>
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
                    {[0, 1, 5, 10, 20, 30].map((d) => (
                      <option key={d} value={d}>
                        {d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `Next ${d} days`}
                      </option>
                    ))}
                  </select>
                  <Link to="/admin/company?tab=analysis" className="text-xs font-medium text-blue-600">
                    Full analysis →
                  </Link>
                </div>
              }
            >
              {(() => {
                if (!summary) return null
                // Still to pay the real companies (not expense accounts) to
                // cover every renewal up to the end of the window, against
                // the cash actually in hand: money received this month minus
                // everything already paid out this month.
                const needed = companyDueRows
                  .filter((r) => r.countsInTotals)
                  .reduce((sum, r) => sum + Math.max(-r.have, 0), 0)
                const cashOnHand = summary.cashSubscribers + summary.cashProducts - summary.companyPaidMonthAll
                const shortfall = needed - cashOnHand
                const isSaturday = new Date().getDay() === 6
                if (needed <= 0 || shortfall <= 0) return null
                return (
                  <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                    <p className="text-xs leading-relaxed text-amber-800">
                      You still need to pay companies{' '}
                      <span className="font-semibold tabular-nums">${needed.toFixed(2)}</span> but have about{' '}
                      <span className="font-semibold tabular-nums">${Math.max(cashOnHand, 0).toFixed(2)}</span> on hand
                      (collected this month minus what's already been paid out) — collect another{' '}
                      <span className="font-semibold tabular-nums">${shortfall.toFixed(2)}</span>.
                      {isSaturday && ' Also, Whish will be closed tomorrow (Sunday) — collect what you need before then.'}
                    </p>
                  </div>
                )
              })()}
              {companyDueRows.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  No company payments due {companyDueDays === 0 ? 'today' : `in the next ${companyDueDays} days`}.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-neutral-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-neutral-50 text-left text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">
                        <th className="px-3 py-2 font-bold">Company</th>
                        <th className="px-3 py-2 text-right font-bold">Users</th>
                        <th className="px-3 py-2 text-right font-bold">Amount</th>
                        <th className="px-3 py-2 text-right font-bold">Have</th>
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
                          <td
                            className={`px-3 py-2 text-right font-semibold tabular-nums ${
                              row.have < 0 ? 'text-red-600' : 'text-emerald-600'
                            }`}
                          >
                            {row.have.toFixed(2)}
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
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-neutral-700">
                          {companyDueRows.reduce((sum, r) => sum + r.have, 0).toFixed(2)}
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
                Invoices generate automatically every night (anyone active who isn't billed for this
                month yet gets billed). Use this to run it now; it's always safe to re-run.
              </p>
              {lastRun && (
                <p className="mb-2 text-xs text-neutral-400">
                  Last run {new Date(lastRun.ran_at).toLocaleString()} ({lastRun.source}): {lastRun.created}{' '}
                  created, {lastRun.skipped} already billed
                  {lastRun.failed > 0 ? `, ${lastRun.failed} failed` : ''}.
                </p>
              )}
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
