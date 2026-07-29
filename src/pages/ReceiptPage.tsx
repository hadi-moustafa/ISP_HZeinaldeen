import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getInvoiceReceipt } from '../lib/api/invoices'
import type { InvoiceReceipt, ReceiptPayment } from '../types/invoices'
import { cardClass } from '../lib/uiClasses'

const statusBadgeClass: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  postponed: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  waived: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
}

export function ReceiptPage() {
  const { id } = useParams()
  const [invoice, setInvoice] = useState<InvoiceReceipt | null>(null)
  const [payments, setPayments] = useState<ReceiptPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getInvoiceReceipt(id)
      .then(({ invoice, payments }) => {
        setInvoice(invoice)
        setPayments(payments)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Receipt not found'))
      .finally(() => setLoading(false))
  }, [id])

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-900">
      <div className={`${cardClass} w-full max-w-sm`}>
        <h1 className="mb-4 text-center text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Invoice Receipt
        </h1>

        {loading && (
          <p className="text-center text-neutral-500 dark:text-neutral-400">Loading…</p>
        )}
        {error && <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>}

        {invoice && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {invoice.subscribers?.name}
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {invoice.services?.name}
                  {invoice.services?.companies?.name && ` · ${invoice.services.companies.name}`}
                </p>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass[invoice.status]}`}
              >
                {invoice.status}
              </span>
            </div>

            <dl className="mb-4 space-y-2 border-t border-neutral-200 pt-4 text-sm dark:border-neutral-700">
              <div className="flex justify-between">
                <dt className="text-neutral-500 dark:text-neutral-400">Period</dt>
                <dd className="text-neutral-900 dark:text-neutral-100">{invoice.period_month}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500 dark:text-neutral-400">Amount due</dt>
                <dd className="text-neutral-900 dark:text-neutral-100">{invoice.amount_due}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500 dark:text-neutral-400">Amount paid</dt>
                <dd className="text-neutral-900 dark:text-neutral-100">{totalPaid}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500 dark:text-neutral-400">Due date</dt>
                <dd className="text-neutral-900 dark:text-neutral-100">
                  {invoice.postponed_to ?? invoice.due_date ?? '—'}
                </dd>
              </div>
            </dl>

            <h2 className="mb-2 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
              Payments
            </h2>
            <div className="space-y-1">
              {payments.map((p, i) => (
                <div
                  key={i}
                  className="flex justify-between rounded-md bg-neutral-50 p-2 text-sm dark:bg-neutral-700/50"
                >
                  <span className="text-neutral-700 dark:text-neutral-200">{p.payment_date}</span>
                  <span className="text-neutral-900 dark:text-neutral-100">
                    {p.amount} ({p.method})
                  </span>
                </div>
              ))}
              {payments.length === 0 && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No payments recorded yet.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
