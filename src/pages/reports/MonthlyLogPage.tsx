import { useEffect, useState } from 'react'
import { listMonthlyLog, listMonthlyFinancials } from '../../lib/api/reports'
import type { MonthlyLogRow } from '../../types/reports'
import { exportToExcel } from '../../lib/exportExcel'
import { inputClass, primaryButtonClass, secondaryButtonClass, cardClass } from '../../lib/uiClasses'

const statusBadgeClass: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  postponed: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  waived: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
}

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

  const visibleRows = onlyUnpaid
    ? rows.filter((r) => r.status === 'unpaid' || r.status === 'partial')
    : rows

  function handleExport() {
    exportToExcel(
      `monthly-log-${month}`,
      visibleRows.map((r) => ({
        Subscriber: r.subscriber_name,
        Owner: r.owner_name ?? '',
        Collector: r.default_collector_name ?? '',
        'Amount Due': r.amount_due,
        'Amount Paid': r.amount_paid,
        Status: r.status,
        'Due Date': r.due_date ?? '',
        'Postponed To': r.postponed_to ?? '',
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
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Due {row.amount_due} · Paid {row.amount_paid}
                </p>
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
            No invoices for this month{onlyUnpaid ? ' matching this filter' : ''}.
          </p>
        )}
      </div>
    </div>
  )
}
