import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Download, Filter, Search, MoreVertical, ChevronDown, Banknote } from 'lucide-react'
import {
  listSubscribers,
  listDebtSubscriberIds,
  deleteSubscriber,
  type SubscriberSearchField,
} from '../../lib/api/subscribers'
import { listOwners } from '../../lib/api/owners'
import { listCollectors } from '../../lib/api/collectors'
import { listCompanies } from '../../lib/api/companies'
import { listServices } from '../../lib/api/services'
import { listMonthlyLog } from '../../lib/api/reports'
import { createPayment } from '../../lib/api/invoices'
import { logActivity } from '../../lib/api/activityLog'
import type { SubscriberWithRelations } from '../../types/subscribers'
import { emptyFilters } from '../../types/subscribers'
import type { MonthlyLogRow } from '../../types/reports'
import type { Owner, Collector, Company, ServiceWithCompany } from '../../types/reference'
import { useStaff } from '../../context/StaffContext'
import { HeaderActions } from '../../components/AppHeader'
import { Modal } from '../../components/Modal'
import { inputClass, labelClass, secondaryButtonClass, primaryButtonClass } from '../../lib/uiClasses'
import { exportToExcel } from '../../lib/exportExcel'

type BillingKey = 'paid' | 'debt' | 'postponed' | 'none'

// Literal client-specified scheme: green = paid, orange = postponed, red = debt.
const BILLING_STYLES: Record<BillingKey, { border: string; pill: string; bar: string; amount: string }> = {
  paid: {
    border: 'border-l-green-500',
    pill: 'bg-green-100 text-green-700',
    bar: 'bg-green-500',
    amount: 'text-green-600',
  },
  debt: {
    border: 'border-l-red-500',
    pill: 'bg-red-100 text-red-700',
    bar: 'bg-red-500',
    amount: 'text-red-600',
  },
  postponed: {
    border: 'border-l-orange-500',
    pill: 'bg-orange-100 text-orange-700',
    bar: 'bg-orange-500',
    amount: 'text-orange-600',
  },
  none: {
    border: 'border-l-neutral-300',
    pill: 'bg-neutral-100 text-neutral-500',
    bar: 'bg-neutral-300',
    amount: 'text-neutral-500',
  },
}

function billingKeyFor(status: string | undefined): BillingKey {
  if (!status) return 'none'
  if (status === 'paid' || status === 'waived') return 'paid'
  if (status === 'postponed') return 'postponed'
  return 'debt' // unpaid, partial
}

function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const SEARCH_FIELDS: { value: SubscriberSearchField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'id', label: 'ID' },
  { value: 'owner', label: 'Owner' },
  { value: 'username', label: 'Username' },
]

export function SubscribersListPage() {
  const navigate = useNavigate()
  const { staff } = useStaff()
  const [filters, setFilters] = useState(emptyFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchField, setSearchField] = useState<SubscriberSearchField>('name')
  const [searchFieldMenuOpen, setSearchFieldMenuOpen] = useState(false)
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [paymentSub, setPaymentSub] = useState<SubscriberWithRelations | null>(null)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    method: 'cash',
    collector_id: '',
    note: '',
  })
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentSaving, setPaymentSaving] = useState(false)

  const [subscribers, setSubscribers] = useState<SubscriberWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [owners, setOwners] = useState<Owner[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [debtIds, setDebtIds] = useState<Set<string>>(new Set())
  const [monthlyLogBySubscriber, setMonthlyLogBySubscriber] = useState<Record<string, MonthlyLogRow>>({})

  async function refreshBillingData() {
    const [debt, log] = await Promise.all([listDebtSubscriberIds(), listMonthlyLog(currentPeriodMonth())])
    setDebtIds(debt)
    setMonthlyLogBySubscriber(Object.fromEntries(log.map((row) => [row.subscriber_id, row])))
  }

  useEffect(() => {
    Promise.all([listOwners(), listCollectors(), listCompanies(), listServices(), refreshBillingData()])
      .then(([o, c, comp, s]) => {
        setOwners(o)
        setCollectors(c)
        setCompanies(comp)
        setServices(s)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load filters'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const ownerIdsForSearch =
      searchField === 'owner' && filters.search.trim()
        ? owners
            .filter((o) => o.name.toLowerCase().includes(filters.search.trim().toLowerCase()))
            .map((o) => o.id)
        : null

    const timer = setTimeout(() => {
      listSubscribers(filters, serviceIdsForCompany, searchField, ownerIdsForSearch)
        .then((rows) => {
          if (cancelled) return
          let result = rows
          if (filters.debtMode === 'in_debt') result = result.filter((r) => debtIds.has(r.id))
          if (filters.debtMode === 'paid_up') result = result.filter((r) => !debtIds.has(r.id))
          if (searchField === 'id' && filters.search.trim()) {
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
  }, [filters, services, debtIds, searchField, owners])

  function updateFilter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  const activeFilterCount = Object.entries(filters).filter(([key, value]) => {
    if (key === 'debtMode') return value !== 'any'
    return value !== ''
  }).length

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport() {
    const rows = selectedIds.size > 0 ? subscribers.filter((s) => selectedIds.has(s.id)) : subscribers
    exportToExcel(
      'subscribers',
      rows.map((s) => {
        const address = s.subscriber_addresses.find((a) => a.is_primary) ?? s.subscriber_addresses[0]
        return {
          Name: s.name,
          Phone: s.phone ?? '',
          Address: address ? [address.line1, address.city].filter(Boolean).join(', ') : '',
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

  function openPaymentModal(sub: SubscriberWithRelations) {
    setOpenCardMenuId(null)
    const log = monthlyLogBySubscriber[sub.id]
    const remaining = log ? Math.max(log.amount_due - log.amount_paid, 0) : 0
    setPaymentError(null)
    setPaymentForm({
      amount: remaining ? String(remaining) : '',
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'cash',
      collector_id: sub.default_collector_id ?? '',
      note: '',
    })
    setPaymentSub(sub)
  }

  async function submitPayment(e: FormEvent) {
    e.preventDefault()
    if (!paymentSub) return
    const log = monthlyLogBySubscriber[paymentSub.id]
    setPaymentSaving(true)
    setPaymentError(null)
    try {
      await createPayment({
        invoice_id: log?.invoice_id ?? null,
        subscriber_id: paymentSub.id,
        collector_id: paymentForm.collector_id || null,
        amount: Number(paymentForm.amount),
        payment_date: paymentForm.payment_date,
        method: paymentForm.method,
        note: paymentForm.note || null,
        staff_id: staff?.id ?? null,
      })
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} logged a payment of ${paymentForm.amount} for subscriber ${paymentSub.name}`,
        'payment',
        paymentSub.id,
      )
      setPaymentSub(null)
      await refreshBillingData()
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Failed to log payment')
    } finally {
      setPaymentSaving(false)
    }
  }

  async function handleDelete(sub: SubscriberWithRelations) {
    setOpenCardMenuId(null)
    if (!confirm(`Delete subscriber "${sub.name}"? This also deletes their addresses.`)) return
    try {
      await deleteSubscriber(sub.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted subscriber ${sub.name}`, 'subscriber', sub.id)
      setSubscribers((prev) => prev.filter((s) => s.id !== sub.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete subscriber')
    }
  }

  const menuOverlayOpen = searchFieldMenuOpen || openCardMenuId !== null

  return (
    <div>
      {menuOverlayOpen && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => {
            setSearchFieldMenuOpen(false)
            setOpenCardMenuId(null)
          }}
        />
      )}

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
          <span className="h-5 w-1 rounded-full bg-indigo-500" />
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
        <div className="flex items-center overflow-hidden rounded-full bg-white shadow-sm dark:bg-neutral-800">
          <div className="shrink-0 border-r border-neutral-100 dark:border-neutral-700">
            <button
              onClick={() => setSearchFieldMenuOpen((v) => !v)}
              className="relative z-20 flex items-center gap-1 px-3 py-2.5 text-sm font-medium text-neutral-700 dark:text-neutral-200"
            >
              {SEARCH_FIELDS.find((f) => f.value === searchField)?.label}
              <ChevronDown size={14} className="text-neutral-400" />
            </button>
          </div>
          <div className="flex flex-1 items-center px-3">
            <Search size={16} className="mr-2 shrink-0 text-neutral-400" />
            <input
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              placeholder={`Search by ${SEARCH_FIELDS.find((f) => f.value === searchField)?.label.toLowerCase()}…`}
              className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-neutral-900 outline-none dark:text-neutral-100"
            />
          </div>
        </div>
        {/* Rendered outside the pill's overflow-hidden container -- an
            ancestor's overflow-hidden clips absolutely-positioned
            descendants regardless of z-index, so nesting this inside the
            pill above hid it entirely. */}
        {searchFieldMenuOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 w-28 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
            {SEARCH_FIELDS.map((f) => (
              <button
                key={f.value}
                onClick={() => {
                  setSearchField(f.value)
                  setSearchFieldMenuOpen(false)
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center gap-2">
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
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium shadow-sm ${
            filtersOpen
              ? 'bg-indigo-500 text-white'
              : 'bg-white text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
          }`}
        >
          <Search size={14} />
          Adv.{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
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
        <div className="ml-auto shrink-0 rounded-full bg-red-100 px-3 py-1.5 text-sm font-bold text-red-700">
          {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Total: ${subscribers.length}`}
        </div>
      </div>

      {filtersOpen && (
        <div className="mb-4 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Connected from</label>
              <input
                type="date"
                value={filters.connectionFrom}
                onChange={(e) => updateFilter('connectionFrom', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Connected to</label>
              <input
                type="date"
                value={filters.connectionTo}
                onChange={(e) => updateFilter('connectionTo', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Phone contains</label>
            <input
              value={filters.phone}
              onChange={(e) => updateFilter('phone', e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>National ID contains</label>
            <input
              value={filters.nationalId}
              onChange={(e) => updateFilter('nationalId', e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Notes contain</label>
            <input
              value={filters.notes}
              onChange={(e) => updateFilter('notes', e.target.value)}
              className={inputClass}
            />
          </div>

          <button onClick={() => setFilters(emptyFilters)} className={secondaryButtonClass}>
            Clear filters
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-3">
        {subscribers.map((sub) => {
          const log = monthlyLogBySubscriber[sub.id]
          const billingKey = billingKeyFor(log?.status)
          const style = BILLING_STYLES[billingKey]
          const pct = log && log.amount_due > 0 ? Math.round((log.amount_paid / log.amount_due) * 100) : 0
          const address = sub.subscriber_addresses.find((a) => a.is_primary) ?? sub.subscriber_addresses[0]

          return (
            <div
              key={sub.id}
              className={`relative rounded-2xl border-l-4 bg-white p-4 shadow-sm dark:bg-neutral-800 ${style.border}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(sub.id)}
                    onChange={() => toggleSelect(sub.id)}
                    aria-label={`Select ${sub.name}`}
                    className="h-4 w-4 rounded border-neutral-300 text-indigo-600"
                  />
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${style.pill}`}>
                    #{sub.id.slice(0, 8)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                    {formatDateTime(sub.updated_at)}
                  </span>
                  <div className="relative">
                    <button
                      onClick={() => setOpenCardMenuId(openCardMenuId === sub.id ? null : sub.id)}
                      className="relative z-20 p-0.5"
                      aria-label="More actions"
                    >
                      <MoreVertical size={16} className="text-neutral-400" />
                    </button>
                    {openCardMenuId === sub.id && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                        <button
                          onClick={() => navigate(`/subscribers/${sub.id}`)}
                          className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-700"
                        >
                          View
                        </button>
                        <button
                          onClick={() => navigate(`/subscribers/${sub.id}/edit`)}
                          className="block w-full px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(sub)}
                          className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <dl className="mb-2 grid grid-cols-[70px_1fr] gap-y-1 text-sm">
                <dt className="text-neutral-400">Name</dt>
                <dd className="font-medium text-neutral-800 dark:text-neutral-100">
                  <Link to={`/subscribers/${sub.id}`} className="hover:underline">
                    {sub.name}
                  </Link>
                  {sub.connection_status !== 'active' && (
                    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                      {sub.connection_status}
                    </span>
                  )}
                </dd>
                <dt className="text-neutral-400">Address</dt>
                <dd className="text-neutral-700 dark:text-neutral-300">
                  {address ? [address.line1, address.city].filter(Boolean).join(', ') || '—' : '—'}
                </dd>
                <dt className="text-neutral-400">Owner</dt>
                <dd className="text-neutral-700 dark:text-neutral-300">{sub.owners?.name ?? '—'}</dd>
                <dt className="text-neutral-400">Service</dt>
                <dd className="font-medium text-neutral-800 dark:text-neutral-100">
                  {sub.services?.name ?? '—'}
                </dd>
                <dt className="text-neutral-400">Collector</dt>
                <dd className="text-neutral-700 dark:text-neutral-300">
                  {sub.default_collector?.name ?? '—'}
                </dd>
              </dl>

              <div className="flex items-center gap-2">
                {log ? (
                  <>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-700">
                      <div
                        className={`h-full rounded-full ${style.bar}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className={`shrink-0 text-xs font-bold ${style.amount}`}>{pct}%</span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {log.amount_paid}/{log.amount_due}
                    </span>
                  </>
                ) : (
                  <p className="flex-1 text-xs text-neutral-400">No invoice this month</p>
                )}
                <button
                  onClick={() => openPaymentModal(sub)}
                  disabled={!log}
                  title={log ? 'Log a payment' : 'No invoice this month'}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                  <Banknote size={13} />
                  Pay
                </button>
              </div>
            </div>
          )
        })}
        {!loading && subscribers.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No subscribers match these filters.</p>
        )}
      </div>

      <Modal
        open={Boolean(paymentSub)}
        onClose={() => setPaymentSub(null)}
        title={`Log payment · ${paymentSub?.name ?? ''}`}
      >
        <form onSubmit={submitPayment}>
          {paymentError && <p className="mb-3 text-sm text-red-600">{paymentError}</p>}
          <label className={labelClass}>Amount</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={paymentForm.amount}
            onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />
          <label className={labelClass}>Payment date</label>
          <input
            type="date"
            value={paymentForm.payment_date}
            onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))}
            className={`${inputClass} mb-4`}
            required
          />
          <label className={labelClass}>Method</label>
          <input
            value={paymentForm.method}
            onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <label className={labelClass}>
            Collector (who actually collected this — may differ from default)
          </label>
          <select
            value={paymentForm.collector_id}
            onChange={(e) => setPaymentForm((f) => ({ ...f, collector_id: e.target.value }))}
            className={`${inputClass} mb-4`}
          >
            <option value="">None</option>
            {collectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className={labelClass}>Note</label>
          <input
            value={paymentForm.note}
            onChange={(e) => setPaymentForm((f) => ({ ...f, note: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPaymentSub(null)} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={paymentSaving} className={primaryButtonClass}>
              {paymentSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
