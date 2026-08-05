import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Download, Filter, Search, MoreVertical, ChevronDown, Banknote } from 'lucide-react'
import {
  listSubscribers,
  listDebtSubscriberIds,
  deleteSubscriber,
  bulkDeleteSubscribers,
  bulkSetConnectionStatus,
  updateSubscriberFields,
  type SubscriberSearchField,
} from '../../lib/api/subscribers'
import { listOwners } from '../../lib/api/owners'
import { listCollectors } from '../../lib/api/collectors'
import { listCompanies } from '../../lib/api/companies'
import { listServices } from '../../lib/api/services'
import { listRegions } from '../../lib/api/regions'
import { listMonthlyLog } from '../../lib/api/reports'
import { createPayment, postponeInvoice, doubleNextMonthInvoice, createInvoice } from '../../lib/api/invoices'
import { logActivity } from '../../lib/api/activityLog'
import { openWhatsApp, paidMessage, postponedMessage, debtMessage } from '../../lib/whatsapp'
import type { SubscriberWithRelations } from '../../types/subscribers'
import { emptyFilters } from '../../types/subscribers'
import type { MonthlyLogRow } from '../../types/reports'
import type { Owner, Collector, Company, ServiceWithCompany, Region } from '../../types/reference'
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

function nextPeriodMonth(period: string) {
  const [y, m] = period.split('-').map(Number)
  const nextM = m === 12 ? 1 : m + 1
  const nextY = m === 12 ? y + 1 : y
  return `${nextY}-${String(nextM).padStart(2, '0')}-01`
}

// Superset of the API's SubscriberSearchField: the free-text modes (name/id/
// owner/username) map straight through to the API's search+searchField
// mechanism; the rest (phone/nationalId/notes/collector/company/service/
// status/expiry/connection) drive the already-existing dedicated filter
// fields on `filters` directly -- this dropdown just controls which single
// control is visible, replacing the old separate "Adv." panel.
type FilterField =
  | 'name' | 'id' | 'owner' | 'username' | 'phone' | 'nationality' | 'notes'
  | 'collector' | 'company' | 'service' | 'region' | 'status' | 'expiry' | 'connection'

const FILTER_FIELDS: { value: FilterField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'id', label: 'ID' },
  { value: 'owner', label: 'Owner' },
  { value: 'username', label: 'Username' },
  { value: 'phone', label: 'Phone' },
  { value: 'nationality', label: 'Nationality' },
  { value: 'notes', label: 'Notes' },
  { value: 'collector', label: 'Collector' },
  { value: 'company', label: 'Company' },
  { value: 'service', label: 'Service' },
  { value: 'region', label: 'Region' },
  { value: 'status', label: 'Connection status' },
  { value: 'expiry', label: 'Expiry date' },
  { value: 'connection', label: 'Connection date' },
]

const TEXT_FILTER_FIELDS: FilterField[] = ['name', 'id', 'owner', 'username', 'phone', 'notes']

export function SubscribersListPage() {
  const navigate = useNavigate()
  const { staff } = useStaff()
  const [filters, setFilters] = useState(emptyFilters)
  const [filterField, setFilterField] = useState<FilterField>('name')
  const [searchFieldMenuOpen, setSearchFieldMenuOpen] = useState(false)
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [paymentSub, setPaymentSub] = useState<SubscriberWithRelations | null>(null)
  const [paymentMode, setPaymentMode] = useState<'paid' | 'postponed' | 'debt'>('paid')
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    method: 'cash',
    collector_id: '',
    note: '',
  })
  const [postponeForm, setPostponeForm] = useState({ new_due_date: '', reason: '' })
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentSaving, setPaymentSaving] = useState(false)

  // Sending the WhatsApp confirmation is an explicit per-action choice, not
  // an automatic side effect of logging a payment/postpone/debt -- staff can
  // uncheck it and the underlying DB action still goes through. phoneDraft/
  // serviceDraft let staff fill in data missing from the subscriber record
  // (no phone on file, or no service assigned yet, which Debt mode needs)
  // right here instead of leaving the modal to edit the subscriber first.
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [serviceDraft, setServiceDraft] = useState('')

  const [subscribers, setSubscribers] = useState<SubscriberWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [owners, setOwners] = useState<Owner[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [debtIds, setDebtIds] = useState<Set<string>>(new Set())
  const [monthlyLogBySubscriber, setMonthlyLogBySubscriber] = useState<Record<string, MonthlyLogRow>>({})

  async function refreshBillingData() {
    const [debt, log] = await Promise.all([listDebtSubscriberIds(), listMonthlyLog(currentPeriodMonth())])
    setDebtIds(debt)
    setMonthlyLogBySubscriber(Object.fromEntries(log.map((row) => [row.subscriber_id, row])))
  }

  useEffect(() => {
    Promise.all([listOwners(), listCollectors(), listCompanies(), listServices(), listRegions(), refreshBillingData()])
      .then(([o, c, comp, s, r]) => {
        setOwners(o)
        setCollectors(c)
        setCompanies(comp)
        setServices(s)
        setRegions(r)
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
        return {
          Name: s.name,
          Phone: s.phone ?? '',
          Address: [s.address, s.regions?.name].filter(Boolean).join(', '),
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

  // Pay is always clickable, even with no invoice yet this period (e.g. a
  // subscriber created between billing runs) -- but nothing is written to
  // the DB just from opening this modal. An invoice only gets created (if
  // one's missing) at actual submit time, inside submitPayment -- otherwise
  // opening the modal and backing out without confirming anything would
  // leave behind a real unpaid invoice and turn the subscriber red/in-debt
  // for an action that never happened.
  function openPaymentModal(sub: SubscriberWithRelations) {
    setOpenCardMenuId(null)
    setPaymentError(null)
    setPaymentMode('paid')

    const log = monthlyLogBySubscriber[sub.id]
    const service = sub.service_id ? services.find((s) => s.id === sub.service_id) : undefined
    const remaining = log ? Math.max(log.amount_due - log.amount_paid, 0) : (service?.sell_price ?? 0)
    setPaymentForm({
      amount: remaining ? String(remaining) : '',
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'cash',
      collector_id: sub.default_collector_id ?? '',
      note: '',
    })
    setPostponeForm({ new_due_date: sub.expiry_date ?? '', reason: '' })
    setSendWhatsApp(true)
    setPhoneDraft(sub.phone ?? '')
    setServiceDraft(sub.service_id ?? '')
    setPaymentSub(sub)
  }

  // Debt amount is anchored to the subscriber's normal monthly rate
  // (services.sell_price), not the current invoice's amount_due, so it
  // stays correct even if this month's invoice was itself already adjusted.
  function debtDoubleAmount(sub: SubscriberWithRelations) {
    const log = monthlyLogBySubscriber[sub.id]
    const base =
      sub.services?.sell_price ?? services.find((s) => s.id === sub.service_id)?.sell_price ?? log?.amount_due ?? 0
    return base * 2
  }

  async function submitPayment(e: FormEvent) {
    e.preventDefault()
    if (!paymentSub) return
    setPaymentSaving(true)
    setPaymentError(null)
    try {
      // Fill in whatever was missing and typed into the modal before acting
      // on it -- phone for the WhatsApp send, service for the Debt amount --
      // so the subscriber record itself gets fixed, not just this one action.
      let sub = paymentSub
      const patch: { phone?: string | null; service_id?: string; company_id?: string | null } = {}
      const trimmedPhone = phoneDraft.trim()
      if (trimmedPhone !== (sub.phone ?? '')) patch.phone = trimmedPhone || null
      if (paymentMode === 'debt' && !sub.service_id && serviceDraft) {
        const chosen = services.find((s) => s.id === serviceDraft)
        patch.service_id = serviceDraft
        patch.company_id = chosen?.comp_id ?? null
      }
      if (Object.keys(patch).length > 0) {
        const updated = await updateSubscriberFields(sub.id, patch)
        sub = { ...sub, ...updated }
        setPaymentSub(sub)
        setSubscribers((prev) => prev.map((s) => (s.id === sub.id ? { ...s, ...updated } : s)))
      }

      // The current period's invoice is only ever created here, at the
      // moment an action is actually being committed -- never just from
      // opening the modal -- so backing out without confirming anything
      // never leaves behind a real invoice or turns the subscriber red.
      let log: MonthlyLogRow | undefined = monthlyLogBySubscriber[sub.id]
      if (!log && (paymentMode === 'paid' || paymentMode === 'postponed') && sub.service_id) {
        const service = services.find((s) => s.id === sub.service_id)
        if (service) {
          await createInvoice({
            subscriber_id: sub.id,
            service_id: sub.service_id,
            period_month: currentPeriodMonth(),
            amount_due: service.sell_price,
          })
          const rows = await listMonthlyLog(currentPeriodMonth())
          setMonthlyLogBySubscriber(Object.fromEntries(rows.map((row) => [row.subscriber_id, row])))
          log = rows.find((row) => row.subscriber_id === sub.id)
        }
      }

      if (paymentMode === 'paid') {
        await createPayment({
          invoice_id: log?.invoice_id ?? null,
          subscriber_id: sub.id,
          collector_id: paymentForm.collector_id || null,
          amount: Number(paymentForm.amount),
          payment_date: paymentForm.payment_date,
          method: paymentForm.method,
          note: paymentForm.note || null,
          staff_id: staff?.id ?? null,
        })
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} logged a payment of ${paymentForm.amount} for subscriber ${sub.name}`,
          'payment',
          sub.id,
        )
        if (sendWhatsApp) openWhatsApp(sub.phone, paidMessage(sub.name))
      } else if (paymentMode === 'postponed') {
        if (!log?.invoice_id) throw new Error('No invoice this period to postpone')
        await postponeInvoice(log.invoice_id, postponeForm.new_due_date, postponeForm.reason || null, staff?.id ?? null)
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} postponed the invoice for subscriber ${sub.name} to ${postponeForm.new_due_date}`,
          'invoice',
          log.invoice_id,
        )
        if (sendWhatsApp) openWhatsApp(sub.phone, postponedMessage(sub.name, postponeForm.new_due_date))
      } else {
        if (!sub.service_id) throw new Error('Subscriber has no service to base the debt amount on -- pick one above')
        const doubled = debtDoubleAmount(sub)
        await doubleNextMonthInvoice(sub.id, sub.service_id, nextPeriodMonth(currentPeriodMonth()), doubled)
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} marked subscriber ${sub.name} as in debt -- next month's payment doubled to ${doubled}`,
          'subscriber',
          sub.id,
        )
        if (sendWhatsApp) openWhatsApp(sub.phone, debtMessage(sub.name, doubled))
      }
      setPaymentSub(null)
      await refreshBillingData()
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Failed to update subscriber')
    } finally {
      setPaymentSaving(false)
    }
  }

  async function handleDelete(sub: SubscriberWithRelations) {
    setOpenCardMenuId(null)
    if (!confirm(`Delete subscriber "${sub.name}"?`)) return
    try {
      await deleteSubscriber(sub.id)
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} deleted subscriber ${sub.name}`, 'subscriber', sub.id)
      setSubscribers((prev) => prev.filter((s) => s.id !== sub.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete subscriber')
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSearchFieldMenuOpen((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 shadow-sm dark:bg-neutral-800 dark:text-neutral-200"
          >
            {FILTER_FIELDS.find((f) => f.value === filterField)?.label}
            <ChevronDown size={14} className="text-neutral-400" />
          </button>

          {TEXT_FILTER_FIELDS.includes(filterField) && (
            <div className="flex flex-1 items-center rounded-full bg-white px-3 shadow-sm dark:bg-neutral-800">
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

          {filterField === 'region' && (
            <select
              value={filters.regionId}
              onChange={(e) => updateFilter('regionId', e.target.value)}
              className="flex-1 rounded-full bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="">Any region</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
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
        {activeFilterCount > 0 && (
          <button onClick={() => setFilters(emptyFilters)} className="shrink-0 text-xs font-medium text-neutral-500">
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

      <div className="space-y-3">
        {subscribers.map((sub) => {
          const log = monthlyLogBySubscriber[sub.id]
          const billingKey = billingKeyFor(log?.status)
          const style = BILLING_STYLES[billingKey]
          const pct = log && log.amount_due > 0 ? Math.round((log.amount_paid / log.amount_due) * 100) : 0
          const addressLine = [sub.address, sub.regions?.name].filter(Boolean).join(', ')

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
                  <span
                    title="Expiry date"
                    className="rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
                  >
                    Exp: {sub.expiry_date ?? '—'}
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
                <dd className="text-neutral-700 dark:text-neutral-300">{addressLine || '—'}</dd>
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
                  title="Log a payment"
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-white"
                >
                  <Banknote size={16} />
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
        title={`Update status · ${paymentSub?.name ?? ''}`}
      >
        <form onSubmit={submitPayment}>
          {paymentError && <p className="mb-3 text-sm text-red-600">{paymentError}</p>}

          <div className="mb-4 flex gap-1 rounded-full bg-neutral-100 p-1">
            {(
              [
                { value: 'paid', label: 'Paid', active: 'bg-green-500 text-white' },
                { value: 'postponed', label: 'Postponed', active: 'bg-orange-500 text-white' },
                { value: 'debt', label: 'Debt', active: 'bg-red-500 text-white' },
              ] as const
            ).map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setPaymentMode(m.value)}
                className={`flex-1 rounded-full py-1.5 text-sm font-medium ${
                  paymentMode === m.value ? m.active : 'text-neutral-600'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {paymentMode === 'paid' && (
            <>
              <p className="mb-4 text-xs text-neutral-500">
                Logs the payment, turns this subscriber green, and pushes their expiry a month
                forward so next month is what gets collected next. WhatsApp confirmation is
                optional below.
              </p>
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
            </>
          )}

          {paymentMode === 'postponed' && (
            <>
              <p className="mb-4 text-xs text-neutral-500">
                Moves this subscriber's expiry to the new date and turns them orange. WhatsApp
                message is optional below.
              </p>
              <label className={labelClass}>New due date</label>
              <input
                type="date"
                value={postponeForm.new_due_date}
                onChange={(e) => setPostponeForm((f) => ({ ...f, new_due_date: e.target.value }))}
                className={`${inputClass} mb-4`}
                required
              />
              <label className={labelClass}>Reason</label>
              <input
                value={postponeForm.reason}
                onChange={(e) => setPostponeForm((f) => ({ ...f, reason: e.target.value }))}
                className={`${inputClass} mb-4`}
              />
            </>
          )}

          {paymentMode === 'debt' && (
            <>
              {paymentSub && !paymentSub.service_id ? (
                <>
                  <p className="mb-3 text-xs text-amber-600">
                    This subscriber has no service assigned yet, so there's no rate to double.
                    Pick one to use for the debt penalty (saved to the subscriber).
                  </p>
                  <label className={labelClass}>Service</label>
                  <select
                    value={serviceDraft}
                    onChange={(e) => setServiceDraft(e.target.value)}
                    className={`${inputClass} mb-4`}
                    required
                  >
                    <option value="">Select a service…</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.companies?.name ?? 'no company'})
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="mb-4 text-xs text-neutral-500">
                  Turns this subscriber red and sets next month's payment to double
                  {paymentSub ? ` (${debtDoubleAmount(paymentSub)})` : ''} as a late-payment
                  penalty. It reverts to the normal amount automatically once that doubled
                  invoice is paid. WhatsApp message is optional below.
                </p>
              )}
            </>
          )}

          <div className="mb-4 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-900">
            {!paymentSub?.phone && (
              <>
                <label className={labelClass}>
                  Phone number (missing — add it to enable WhatsApp)
                </label>
                <input
                  type="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  placeholder="e.g. 03123456"
                  className={`${inputClass} mb-3`}
                />
              </>
            )}
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
              <input
                type="checkbox"
                checked={sendWhatsApp}
                onChange={(e) => setSendWhatsApp(e.target.checked)}
                disabled={!phoneDraft.trim() && !paymentSub?.phone}
                className="h-4 w-4 rounded border-neutral-300 text-indigo-600"
              />
              Send WhatsApp confirmation to the subscriber
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPaymentSub(null)} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={paymentSaving} className={primaryButtonClass}>
              {paymentSaving ? 'Saving…' : sendWhatsApp ? 'Save & Notify' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
