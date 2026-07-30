import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { offlineDB, type CachedInvoice, type CachedSubscriber } from '../lib/offline/db'
import {
  downloadAssignedData,
  flushQueue,
  logPayment,
  pendingSyncCount,
  postponeInvoiceOffline,
} from '../lib/offline/sync'
import { Modal } from '../components/Modal'
import { logActivity } from '../lib/api/activityLog'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  cardClass,
} from '../lib/uiClasses'

const statusBadgeClass: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  postponed: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
}

export function OfflinePage() {
  const { staff } = useStaff()
  const online = useOnlineStatus()

  const [subscribers, setSubscribers] = useState<CachedSubscriber[]>([])
  const [invoicesBySubscriber, setInvoicesBySubscriber] = useState<
    Record<string, CachedInvoice[]>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const [paymentSub, setPaymentSub] = useState<CachedSubscriber | null>(null)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    method: 'cash',
    note: '',
  })

  const [postponeInvoice, setPostponeInvoice] = useState<CachedInvoice | null>(null)
  const [postponeForm, setPostponeForm] = useState({ new_due_date: '', reason: '' })

  async function loadFromCache() {
    const subs = await offlineDB.subscribers.toArray()
    const invs = await offlineDB.invoices.toArray()
    const bySub: Record<string, CachedInvoice[]> = {}
    for (const inv of invs) {
      ;(bySub[inv.subscriber_id] ??= []).push(inv)
    }
    for (const list of Object.values(bySub)) {
      list.sort((a, b) => (a.period_month < b.period_month ? 1 : -1))
    }
    setSubscribers(subs)
    setInvoicesBySubscriber(bySub)
    setPending(await pendingSyncCount())
  }

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      if (online && staff?.collectorId) {
        await downloadAssignedData(staff.collectorId)
      }
      if (online) {
        setSyncing(true)
        await flushQueue()
        setSyncing(false)
      }
      await loadFromCache()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  function currentInvoice(subscriberId: string) {
    const invoices = invoicesBySubscriber[subscriberId] ?? []
    return invoices.find((i) => i.status === 'unpaid' || i.status === 'partial') ?? invoices[0]
  }

  function openPaymentModal(sub: CachedSubscriber) {
    const invoice = currentInvoice(sub.id)
    setPaymentSub(sub)
    setPaymentForm({
      amount: invoice ? String(invoice.amount_due - invoice.amount_paid) : '',
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'cash',
      note: '',
    })
  }

  async function submitPayment(e: FormEvent) {
    e.preventDefault()
    if (!paymentSub) return
    const invoice = currentInvoice(paymentSub.id)
    try {
      await logPayment(
        {
          id: crypto.randomUUID(),
          invoice_id: invoice?.id ?? null,
          subscriber_id: paymentSub.id,
          collector_id: staff?.collectorId ?? null,
          amount: Number(paymentForm.amount),
          payment_date: paymentForm.payment_date,
          method: paymentForm.method,
          note: paymentForm.note || null,
          staff_id: staff?.id ?? null,
        },
        online,
      )
      if (online) {
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} logged a payment of ${paymentForm.amount} for subscriber ${paymentSub.name} (field)`,
          'payment',
          paymentSub.id,
        )
      }
      setPaymentSub(null)
      await loadFromCache()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log payment')
    }
  }

  function openPostponeModal(invoice: CachedInvoice) {
    setPostponeInvoice(invoice)
    setPostponeForm({ new_due_date: invoice.due_date ?? '', reason: '' })
  }

  async function submitPostpone(e: FormEvent) {
    e.preventDefault()
    if (!postponeInvoice) return
    try {
      await postponeInvoiceOffline(
        {
          p_invoice_id: postponeInvoice.id,
          p_new_due_date: postponeForm.new_due_date,
          p_reason: postponeForm.reason || null,
          p_staff_id: staff?.id ?? null,
        },
        online,
      )
      if (online) {
        logActivity(
          staff?.id ?? null,
          `${staff?.username ?? 'Someone'} postponed an invoice to ${postponeForm.new_due_date} (field)`,
          'invoice',
          postponeInvoice.id,
        )
      }
      setPostponeInvoice(null)
      await loadFromCache()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to postpone invoice')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-4 dark:bg-neutral-900">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/" className="text-sm text-blue-600 dark:text-blue-400">
          ← Dashboard
        </Link>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            online
              ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
              : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
          }`}
        >
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Field View
      </h1>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        {pending > 0
          ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync${syncing ? ' (syncing…)' : ''}`
          : 'All changes synced'}
      </p>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-2">
        {subscribers.map((sub) => {
          const invoice = currentInvoice(sub.id)
          return (
            <div key={sub.id} className={cardClass}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{sub.name}</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {sub.phone ?? '—'}
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">
                    {sub.service_name ?? 'No service'}
                    {sub.company_name && ` · ${sub.company_name}`}
                  </p>
                  {invoice && (
                    <p className="text-sm">
                      Due {invoice.amount_due} · Paid {invoice.amount_paid}
                    </p>
                  )}
                </div>
                {invoice && (
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass[invoice.status]}`}
                  >
                    {invoice.status}
                  </span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => openPaymentModal(sub)} className={secondaryButtonClass}>
                  Log payment
                </button>
                {invoice && (
                  <button
                    onClick={() => openPostponeModal(invoice)}
                    className={secondaryButtonClass}
                  >
                    Postpone
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {!loading && subscribers.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">
            No assigned subscribers cached yet. Connect to sync.
          </p>
        )}
      </div>

      <Modal
        open={Boolean(paymentSub)}
        onClose={() => setPaymentSub(null)}
        title={`Log payment · ${paymentSub?.name ?? ''}`}
      >
        <form onSubmit={submitPayment}>
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
          <label className={labelClass}>Note</label>
          <input
            value={paymentForm.note}
            onChange={(e) => setPaymentForm((f) => ({ ...f, note: e.target.value }))}
            className={`${inputClass} mb-4`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPaymentSub(null)}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass}>
              {online ? 'Save' : 'Save offline'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(postponeInvoice)}
        onClose={() => setPostponeInvoice(null)}
        title={`Postpone · ${postponeInvoice?.period_month ?? ''}`}
      >
        <form onSubmit={submitPostpone}>
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
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPostponeInvoice(null)}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass}>
              {online ? 'Save' : 'Save offline'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
