import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Download, Filter, Search, ChevronDown } from 'lucide-react'
import {
  listSubscribers,
  listDebtSubscriberIds,
  bulkDeleteSubscribers,
  bulkSetConnectionStatus,
  type SubscriberSearchField,
} from '../../lib/api/subscribers'
import { listOwners } from '../../lib/api/owners'
import { listCollectors } from '../../lib/api/collectors'
import { listCompanies } from '../../lib/api/companies'
import { listServices } from '../../lib/api/services'
import { listAddresses } from '../../lib/api/addresses'
import { listRegions } from '../../lib/api/regions'
import { addToCollectTrack } from '../../lib/api/collectTrack'
import { listMonthlyLog } from '../../lib/api/reports'
import { logActivity } from '../../lib/api/activityLog'
import type { SubscriberWithRelations } from '../../types/subscribers'
import { emptyFilters } from '../../types/subscribers'
import { FILTER_FIELDS, TEXT_FILTER_FIELDS, type FilterField } from '../../lib/subscriberFilterFields'
import type { MonthlyLogRow } from '../../types/reports'
import type { Owner, Collector, Company, ServiceWithCompany, Address, Region } from '../../types/reference'
import { useStaff } from '../../context/StaffContext'
import { HeaderActions } from '../../components/AppHeader'
import { PaymentModal } from '../../components/subscriber/PaymentModal'
import { SubscriberRow } from '../../components/subscriber/SubscriberRow'
import { currentPeriodMonth, compareByExpiryDay, quickPostpone, billingKeyFor } from '../../lib/subscriberRowHelpers'
import { exportToExcel } from '../../lib/exportExcel'
import { useLocalStorageState } from '../../lib/useLocalStorageState'

// Superset of the API's SubscriberSearchField: the free-text modes (name/id/
// owner/username) map straight through to the API's search+searchField
// mechanism; the rest (phone/nationalId/notes/collector/company/service/
// status/expiry/connection) drive the already-existing dedicated filter
// fields on `filters` directly -- this dropdown just controls which single
// control is visible, replacing the old separate "Adv." panel.
// (FilterField/FILTER_FIELDS/TEXT_FILTER_FIELDS live in
// lib/subscriberFilterFields.ts, shared with the dashboard's filter panel.)

export function SubscribersListPage() {
  const { staff } = useStaff()
  const [filters, setFilters] = useLocalStorageState('isp:subscribers-filters:filters', emptyFilters)
  const [filterField, setFilterField] = useLocalStorageState<FilterField>('isp:subscribers-filters:field', 'name')
  const [searchFieldMenuOpen, setSearchFieldMenuOpen] = useState(false)
  const [postponingId, setPostponingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Which subscriber the shared PaymentModal is open for, if any --
  // PaymentModal owns all of its own form state.
  const [paymentSub, setPaymentSub] = useState<SubscriberWithRelations | null>(null)

  const [subscribers, setSubscribers] = useState<SubscriberWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [owners, setOwners] = useState<Owner[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [addresses, setAddresses] = useState<Address[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [debtIds, setDebtIds] = useState<Set<string>>(new Set())
  const [monthlyLogBySubscriber, setMonthlyLogBySubscriber] = useState<Record<string, MonthlyLogRow>>({})

  // New storage key: the old one could hold 'none' (unsorted), which no
  // longer exists -- lists always read smallest-to-largest by default now.
  const [sortMode, setSortMode] = useLocalStorageState<'expiry_asc' | 'expiry_desc'>(
    'isp:subscribers-filters:sort-v2',
    'expiry_asc',
  )
  const [billingFilter, setBillingFilter] = useLocalStorageState<'any' | 'paid' | 'unpaid'>(
    'isp:subscribers-filters:billing',
    'any',
  )

  async function refreshBillingData() {
    const [debt, log] = await Promise.all([listDebtSubscriberIds(), listMonthlyLog(currentPeriodMonth())])
    setDebtIds(debt)
    setMonthlyLogBySubscriber(Object.fromEntries(log.map((row) => [row.subscriber_id, row])))
  }

  useEffect(() => {
    Promise.all([
      listOwners(),
      listCollectors(),
      listCompanies(),
      listServices(),
      listAddresses(),
      listRegions(),
      refreshBillingData(),
    ])
      .then(([o, c, comp, s, addrs, rgs]) => {
        setOwners(o)
        setCollectors(c)
        setCompanies(comp)
        setServices(s)
        setAddresses(addrs)
        setRegions(rgs)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load filters'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredServices = useMemo(
    () => (filters.companyId ? services.filter((s) => s.comp_id === filters.companyId) : services),
    [services, filters.companyId],
  )

  // Region is the filter's second tier, scoped under the chosen Address --
  // empty (and the Region select disabled) until an Address is picked.
  const filteredRegions = useMemo(
    () => (filters.addressId ? regions.filter((r) => r.address_id === filters.addressId) : []),
    [regions, filters.addressId],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const serviceIdsForCompany =
      filters.companyId && !filters.serviceId
        ? services.filter((s) => s.comp_id === filters.companyId).map((s) => s.id)
        : null

    const ownerIdsForSearch =
      filterField === 'owner' && filters.search.trim()
        ? owners
            .filter((o) => o.name.toLowerCase().includes(filters.search.trim().toLowerCase()))
            .map((o) => o.id)
        : null

    // Only the free-text modes drive the API's search/searchField mechanism;
    // the rest already apply via their own dedicated filter fields, so any
    // placeholder value here is inert as long as filters.search is blank.
    const apiSearchField: SubscriberSearchField =
      filterField === 'id' || filterField === 'owner' || filterField === 'username' ? filterField : 'name'

    const timer = setTimeout(() => {
      listSubscribers(filters, serviceIdsForCompany, apiSearchField, ownerIdsForSearch)
        .then((rows) => {
          if (cancelled) return
          let result = rows
          if (filters.debtMode === 'in_debt') result = result.filter((r) => debtIds.has(r.id))
          if (filters.debtMode === 'paid_up') result = result.filter((r) => !debtIds.has(r.id))
          if (filterField === 'id' && filters.search.trim()) {
            const term = filters.search.trim().toLowerCase()
            result = result.filter((r) => r.id.toLowerCase().includes(term))
          }
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
  }, [filters, services, debtIds, filterField, owners])

  function updateFilter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  // Switching which attribute to filter by clears the other filter fields
  // (but not debtMode, which the separate All/Debt chips control) so only
  // one filter control is ever showing a stale, invisible value.
  function selectFilterField(field: FilterField) {
    setFilterField(field)
    setSearchFieldMenuOpen(false)
    setFilters((f) => ({ ...emptyFilters, debtMode: f.debtMode }))
  }

  // Counts everything the "Clear filters" button resets -- not just the
  // `filters` object, but also billingFilter/sortMode/filterField, so the
  // button (and its visibility) matches "all the filters, not just these"
  // rather than only the original subset.
  const activeFilterCount =
    Object.entries(filters).filter(([key, value]) => {
      if (key === 'debtMode') return value !== 'any'
      return value !== ''
    }).length +
    (billingFilter !== 'any' ? 1 : 0) +
    (sortMode !== 'expiry_asc' ? 1 : 0) +
    (filterField !== 'name' ? 1 : 0)

  function clearAllFilters() {
    setFilters(emptyFilters)
    setFilterField('name')
    setBillingFilter('any')
    setSortMode('expiry_asc')
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport() {
    const rows = selectedIds.size > 0 ? displaySubscribers.filter((s) => selectedIds.has(s.id)) : displaySubscribers
    exportToExcel(
      'subscribers',
      rows.map((s) => {
        return {
          Name: s.name,
          Phone: s.phone ?? '',
          Address: [s.addresses?.name, s.regions?.name, s.building].filter(Boolean).join(', '),
          Service: s.services?.name ?? '',
          Company: s.services?.companies?.name ?? '',
          Owner: s.owners?.name ?? '',
          'Default Collector': s.default_collector?.name ?? '',
          Status: s.connection_status,
          'Expiry Date': s.expiry_date ?? '',
          'In Debt': debtIds.has(s.id) ? 'Yes' : 'No',
        }
      }),
    )
  }

  async function handleQuickPostpone(sub: SubscriberWithRelations) {
    setPostponingId(sub.id)
    try {
      if (await quickPostpone(sub, monthlyLogBySubscriber[sub.id], staff?.id ?? null, 'subscriber list')) {
        await refreshBillingData()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to postpone')
    } finally {
      setPostponingId(null)
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} selected subscriber${ids.length > 1 ? 's' : ''}?`)) return
    try {
      await bulkDeleteSubscribers(ids)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted ${ids.length} subscribers`, 'subscriber')
      setSubscribers((prev) => prev.filter((s) => !selectedIds.has(s.id)))
      setSelectedIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete selected subscribers')
    }
  }

  async function handleBulkDeactivate() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!confirm(`Deactivate ${ids.length} selected subscriber${ids.length > 1 ? 's' : ''}?`)) return
    try {
      await bulkSetConnectionStatus(ids, 'suspended')
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deactivated ${ids.length} subscribers`, 'subscriber')
      setSubscribers((prev) =>
        prev.map((s) => (selectedIds.has(s.id) ? { ...s, connection_status: 'suspended' } : s)),
      )
      setSelectedIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate selected subscribers')
    }
  }

  async function handleBulkAddToTrack() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0 || !staff) return
    try {
      await addToCollectTrack(staff.id, ids)
      logActivity(staff.id, `${staff.username} added ${ids.length} subscribers to their collect track`, 'subscriber')
      setSelectedIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add selected subscribers to collect track')
    }
  }


  // Always smallest-to-largest expiry day by default (client instruction:
  // "view every output in increasing order"), with a descending option.
  // Sorted by day-of-month, since that's the number each row shows.
  const displaySubscribers = useMemo(() => {
    const billingFiltered =
      billingFilter === 'any'
        ? subscribers
        : subscribers.filter((s) => {
            const paid = billingKeyFor(monthlyLogBySubscriber[s.id], s.debt) === 'paid'
            return billingFilter === 'paid' ? paid : !paid
          })
    const sorted = [...billingFiltered].sort(compareByExpiryDay)
    return sortMode === 'expiry_desc' ? sorted.reverse() : sorted
  }, [subscribers, monthlyLogBySubscriber, sortMode, billingFilter])

  return (
    <div>
      {searchFieldMenuOpen && <div className="fixed inset-0 z-10" onClick={() => setSearchFieldMenuOpen(false)} />}

      <HeaderActions>
        <button
          onClick={handleExport}
          title={selectedIds.size > 0 ? `Export ${selectedIds.size} selected` : 'Export to Excel'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white"
        >
          <Download size={16} />
        </button>
      </HeaderActions>

      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="ui-decor h-5 w-1 rounded-full bg-indigo-500" />
          <h1 className="text-lg font-bold text-neutral-900">List Subscribers</h1>
        </div>
        <Link
          to="/subscribers/new"
          title="Add subscriber"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white shadow-sm active:bg-indigo-600"
        >
          <Plus size={18} strokeWidth={2.5} />
        </Link>
      </div>

      <div className="relative mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSearchFieldMenuOpen((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 shadow-sm dark:bg-neutral-800 dark:text-neutral-200"
          >
            {FILTER_FIELDS.find((f) => f.value === filterField)?.label}
            <ChevronDown size={14} className="text-neutral-400" />
          </button>

          {TEXT_FILTER_FIELDS.includes(filterField) && (
            <div className="flex min-w-40 flex-1 items-center rounded-full bg-white px-3 shadow-sm dark:bg-neutral-800">
              <Search size={16} className="mr-2 shrink-0 text-neutral-400" />
              <input
                value={
                  filterField === 'phone'
                    ? filters.phone
                    : filterField === 'notes'
                      ? filters.notes
                      : filters.search
                }
                onChange={(e) => {
                  const value = e.target.value
                  if (filterField === 'phone') updateFilter('phone', value)
                  else if (filterField === 'notes') updateFilter('notes', value)
                  else updateFilter('search', value)
                }}
                placeholder={`Search by ${FILTER_FIELDS.find((f) => f.value === filterField)?.label.toLowerCase()}…`}
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-neutral-900 outline-none dark:text-neutral-100"
              />
            </div>
          )}

          {filterField === 'collector' && (
            <select
              value={filters.collectorId}
              onChange={(e) => updateFilter('collectorId', e.target.value)}
              className="flex-1 rounded-full bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
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
              className="flex-1 rounded-full bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
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
              className="flex-1 rounded-full bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
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
            <>
              <div className="flex flex-1 gap-2">
              <select
                value={filters.addressId}
                onChange={(e) => {
                  // Picking a different address invalidates whatever region
                  // was scoped to the old one -- the two-tier filter only
                  // works one direction, address narrows region, not the
                  // reverse.
                  const addressId = e.target.value
                  setFilters((f) => ({ ...f, addressId, regionId: '' }))
                }}
                className="min-w-0 flex-1 rounded-full bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="">Any address</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                value={filters.regionId}
                onChange={(e) => updateFilter('regionId', e.target.value)}
                disabled={!filters.addressId}
                className="min-w-0 flex-1 rounded-full bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="">{filters.addressId ? 'Any region' : 'Pick an address first'}</option>
                {filteredRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              </div>
              {/* Address narrows the list, then the name search narrows it
                  further -- both filters apply together. */}
              <div className="flex w-full items-center rounded-full bg-white px-3 shadow-sm dark:bg-neutral-800">
                <Search size={16} className="mr-2 shrink-0 text-neutral-400" />
                <input
                  value={filters.search}
                  onChange={(e) => updateFilter('search', e.target.value)}
                  placeholder="Search by name…"
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-neutral-900 outline-none dark:text-neutral-100"
                />
              </div>
            </>
          )}

          {filterField === 'nationality' && (
            <select
              value={filters.nationality}
              onChange={(e) => updateFilter('nationality', e.target.value as typeof filters.nationality)}
              className="flex-1 rounded-full bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
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
              className="flex-1 rounded-full bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
          )}

          {filterField === 'expiry' && (
            <div className="flex flex-1 gap-2">
              <input
                type="date"
                value={filters.expiryFrom}
                onChange={(e) => updateFilter('expiryFrom', e.target.value)}
                className="min-w-0 flex-1 rounded-full bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
              />
              <input
                type="date"
                value={filters.expiryTo}
                onChange={(e) => updateFilter('expiryTo', e.target.value)}
                className="min-w-0 flex-1 rounded-full bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          )}

          {filterField === 'connection' && (
            <div className="flex flex-1 gap-2">
              <input
                type="date"
                value={filters.connectionFrom}
                onChange={(e) => updateFilter('connectionFrom', e.target.value)}
                className="min-w-0 flex-1 rounded-full bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
              />
              <input
                type="date"
                value={filters.connectionTo}
                onChange={(e) => updateFilter('connectionTo', e.target.value)}
                className="min-w-0 flex-1 rounded-full bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          )}
        </div>

        {/* Rendered outside any overflow-hidden container -- an ancestor's
            overflow-hidden clips absolutely-positioned descendants
            regardless of z-index. */}
        {searchFieldMenuOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-40 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
            {FILTER_FIELDS.map((f) => (
              <button
                key={f.value}
                onClick={() => selectFilterField(f.value)}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700 ${
                  f.value === filterField
                    ? 'font-semibold text-indigo-600'
                    : 'text-neutral-700 dark:text-neutral-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => updateFilter('debtMode', 'any')}
          className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium shadow-sm ${
            filters.debtMode === 'any'
              ? 'bg-indigo-500 text-white'
              : 'bg-white text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
          }`}
        >
          All
        </button>
        <select
          value={billingFilter}
          onChange={(e) => setBillingFilter(e.target.value as typeof billingFilter)}
          className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium shadow-sm ${
            billingFilter === 'paid'
              ? 'bg-green-500 text-white'
              : billingFilter === 'unpaid'
                ? 'bg-amber-500 text-white'
                : 'bg-white text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
          }`}
        >
          <option value="any">Payment: any</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
        <button
          onClick={() => updateFilter('debtMode', filters.debtMode === 'in_debt' ? 'any' : 'in_debt')}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium shadow-sm ${
            filters.debtMode === 'in_debt'
              ? 'bg-rose-500 text-white'
              : 'bg-white text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
          }`}
        >
          <Filter size={14} />
          Debt
        </button>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
          className="shrink-0 rounded-full bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm dark:bg-neutral-800 dark:text-neutral-200"
        >
          <option value="expiry_asc">Expiry ↑</option>
          <option value="expiry_desc">Expiry ↓</option>
        </select>
        {activeFilterCount > 0 && (
          <button onClick={clearAllFilters} className="shrink-0 text-xs font-medium text-neutral-500">
            Clear filters
          </button>
        )}
        {subscribers.length > 0 && (
          <button
            onClick={() =>
              setSelectedIds((prev) =>
                prev.size === subscribers.length ? new Set() : new Set(subscribers.map((s) => s.id)),
              )
            }
            className="shrink-0 text-xs font-medium text-indigo-600"
          >
            {selectedIds.size === subscribers.length ? 'Clear' : 'Select all'}
          </button>
        )}
        {selectedIds.size > 0 && (
          <>
            <button
              onClick={handleBulkAddToTrack}
              className="shrink-0 rounded-full bg-indigo-100 px-3 py-2 text-xs font-semibold text-indigo-700"
            >
              Add to collect track
            </button>
            <button
              onClick={handleBulkDeactivate}
              className="shrink-0 rounded-full bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-700"
            >
              Deactivate
            </button>
            <button
              onClick={handleBulkDelete}
              className="shrink-0 rounded-full bg-red-100 px-3 py-2 text-xs font-semibold text-red-700"
            >
              Delete
            </button>
          </>
        )}
        <div className="ml-auto shrink-0 rounded-full bg-red-100 px-3 py-1.5 text-sm font-bold text-red-700">
          {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Total: ${subscribers.length}`}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-1.5">
        {displaySubscribers.map((sub) => (
          <SubscriberRow
            key={sub.id}
            sub={sub}
            log={monthlyLogBySubscriber[sub.id]}
            selected={selectedIds.has(sub.id)}
            onToggleSelect={toggleSelect}
            onPay={setPaymentSub}
            onPostpone={handleQuickPostpone}
            postponing={postponingId === sub.id}
          />
        ))}
        {!loading && subscribers.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No subscribers match these filters.</p>
        )}
      </div>

      <PaymentModal
        subscriber={paymentSub}
        onClose={() => setPaymentSub(null)}
        onChanged={refreshBillingData}
        services={services}
        collectors={collectors}
        monthlyLog={paymentSub ? monthlyLogBySubscriber[paymentSub.id] : undefined}
      />
    </div>
  )
}
