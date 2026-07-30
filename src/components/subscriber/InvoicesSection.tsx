import { useEffect, useState, type FormEvent } from 'react'
import {
  listInvoicesForSubscriber,
  listPaymentsForInvoice,
  createPayment,
  postponeInvoice,
} from '../../lib/api/invoices'
import type { Invoice, PaymentWithCollector } from '../../types/invoices'
import type { Collector } from '../../types/reference'
import { useStaff } from '../../context/StaffContext'
import { logActivity } from '../../lib/api/activityLog'
import { openWhatsApp } from '../../lib/whatsapp'
import { Modal } from '../Modal'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  cardClass,
} from '../../lib/uiClasses'

const statusBadgeClass: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  postponed: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  waived: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
}

export function InvoicesSection({
  subscriberId,
  subscriberName,
  subscriberPhone,
  defaultCollectorId,
  collectors,
  onChanged,
}: {
  subscriberId: string
  subscriberName: string
  subscriberPhone: string | null
  defaultCollectorId: string | null
  collectors: Collector[]
  onChanged?: () => void
}) {
  const { staff } = useStaff()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [payments, setPayments] = useState<Record<string, PaymentWithCollector[]>>({})

  const [paymentModalInvoice, setPaymentModalInvoice] = useState<Invoice | null>(null)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    method: 'cash',
    collector_id: '',
    note: '',
  })

  const [postponeModalInvoice, setPostponeModalInvoice] = useState<Invoice | null>(null)
  const [postponeForm, setPostponeForm] = useState({ new_due_date: '', reason: '' })

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      setInvoices(await listInvoicesForSubscriber(subscriberId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriberId])

  async function toggleExpand(invoiceId: string) {
    if (expandedId === invoiceId) {
      setExpandedId(null)
      return
    }
    setExpandedId(invoiceId)
    if (!payments[invoiceId]) {
      try {
        const rows = await listPaymentsForInvoice(invoiceId)
        setPayments((prev) => ({ ...prev, [invoiceId]: rows }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payments')
      }
    }
  }

  function openPaymentModal(invoice: Invoice) {
    setPaymentModalInvoice(invoice)
    setPaymentForm({
      amount: String(invoice.amount_due),
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'cash',
      collector_id: defaultCollectorId ?? '',
      note: '',
    })
  }

  async function submitPayment(e: FormEvent) {
    e.preventDefault()
    if (!paymentModalInvoice) return
    try {
      await createPayment({
        invoice_id: paymentModalInvoice.id,
        subscriber_id: subscriberId,
        collector_id: paymentForm.collector_id || null,
        amount: Number(paymentForm.amount),
        payment_date: paymentForm.payment_date,
        method: paymentForm.method,
        note: paymentForm.note || null,
        staff_id: staff?.id ?? null,
      })
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} logged a payment of ${paymentForm.amount} for subscriber ${subscriberName}`,
        'payment',
        paymentModalInvoice.id,
      )
      setPaymentModalInvoice(null)
      await refresh()
      const rows = await listPaymentsForInvoice(paymentModalInvoice.id)
      setPayments((prev) => ({ ...prev, [paymentModalInvoice.id]: rows }))
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log payment')
    }
  }

  function openPostponeModal(invoice: Invoice) {
    setPostponeModalInvoice(invoice)
    setPostponeForm({ new_due_date: invoice.due_date ?? '', reason: '' })
  }

  async function submitPostpone(e: FormEvent) {
    e.preventDefault()
    if (!postponeModalInvoice) return
    try {
      await postponeInvoice(
        postponeModalInvoice.id,
        postponeForm.new_due_date,
        postponeForm.reason || null,
        staff?.id ?? null,
      )
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} postponed the invoice for subscriber ${subscriberName} to ${postponeForm.new_due_date}`,
        'invoice',
        postponeModalInvoice.id,
      )
      setPostponeModalInvoice(null)
      await refresh()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to postpone invoice')
    }
  }

  function shareViaWhatsApp(invoice: Invoice) {
    const receiptUrl = `${window.location.origin}/receipt/${invoice.id}`
    const message = `Hi ${subscriberName}, here's your receipt for ${invoice.period_month}: ${receiptUrl}`
    if (!openWhatsApp(subscriberPhone, message)) {
      setError('Subscriber has no phone number on file')
    }
  }

  return (
    <div>
      <h2 className="mb-3 mt-6 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
        Invoices
      </h2>

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-2">
        {invoices.map((invoice) => (
          <div key={invoice.id} className={cardClass}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {invoice.period_month}
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Due {invoice.amount_due}
                  {invoice.postponed_to && ` · postponed to ${invoice.postponed_to}`}
                </p>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass[invoice.status]}`}
              >
                {invoice.status}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => openPaymentModal(invoice)} className={secondaryButtonClass}>
                Log payment
              </button>
              <button onClick={() => openPostponeModal(invoice)} className={secondaryButtonClass}>
                Postpone
              </button>
              <button onClick={() => shareViaWhatsApp(invoice)} className={secondaryButtonClass}>
                Share via WhatsApp
              </button>
              <button
                onClick={() => toggleExpand(invoice.id)}
                className="px-2 py-2.5 text-sm text-blue-600 dark:text-blue-400"
              >
                {expandedId === invoice.id ? 'Hide payments' : 'Show payments'}
              </button>
            </div>

            {expandedId === invoice.id && (
              <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
                {(payments[invoice.id] ?? []).map((payment) => (
                  <div
                    key={payment.id}
                    className="rounded-md bg-neutral-50 p-2 text-sm dark:bg-neutral-700/50"
                  >
                    <p className="text-neutral-800 dark:text-neutral-100">
                      {payment.amount} on {payment.payment_date} via {payment.method}
                    </p>
                    <p className="text-neutral-500 dark:text-neutral-400">
                      Collector: {payment.collectors?.name ?? '—'}
                      {payment.note && ` · ${payment.note}`}
                    </p>
                  </div>
                ))}
                {(payments[invoice.id] ?? []).length === 0 && (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No payments logged yet.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && invoices.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No invoices yet.</p>
        )}
      </div>

      <Modal
        open={Boolean(paymentModalInvoice)}
        onClose={() => setPaymentModalInvoice(null)}
        title={`Log payment · ${paymentModalInvoice?.period_month ?? ''}`}
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
            <button
              type="button"
              onClick={() => setPaymentModalInvoice(null)}
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
        open={Boolean(postponeModalInvoice)}
        onClose={() => setPostponeModalInvoice(null)}
        title={`Postpone · ${postponeModalInvoice?.period_month ?? ''}`}
      >
        <form onSubmit={submitPostpone}>
          <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
            Also moves this subscriber's expiry date to the new due date.
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
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPostponeModalInvoice(null)}
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
