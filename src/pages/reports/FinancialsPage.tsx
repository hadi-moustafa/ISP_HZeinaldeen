import { useEffect, useMemo, useState } from 'react'
import { listMonthlyFinancials } from '../../lib/api/reports'
import type { MonthlyFinancialRow } from '../../types/reports'
import { exportToExcel } from '../../lib/exportExcel'
import { secondaryButtonClass, cardClass } from '../../lib/uiClasses'

export function FinancialsPage() {
  const [rows, setRows] = useState<MonthlyFinancialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listMonthlyFinancials()
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load financials'))
      .finally(() => setLoading(false))
  }, [])

  const byMonth = useMemo(() => {
    const map = new Map<string, { services: number; products: number }>()
    for (const row of rows) {
      const entry = map.get(row.period_month) ?? { services: 0, products: 0 }
      entry[row.revenue_type] = row.total
      map.set(row.period_month, entry)
    }
    return Array.from(map.entries())
      .map(([period_month, totals]) => ({
        period_month,
        ...totals,
        total: totals.services + totals.products,
      }))
      .sort((a, b) => (a.period_month < b.period_month ? 1 : -1))
  }, [rows])

  function handleExport() {
    exportToExcel(
      'financials',
      byMonth.map((m) => ({
        Month: m.period_month,
        'Services Revenue': m.services,
        'Products Revenue': m.products,
        Total: m.total,
      })),
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Financial Report
        </h1>
        <button onClick={handleExport} className={secondaryButtonClass}>
          Export to Excel
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      <div className="space-y-2">
        {byMonth.map((m) => (
          <div key={m.period_month} className={cardClass}>
            <p className="font-medium text-neutral-900 dark:text-neutral-100">
              {m.period_month}
            </p>
            <div className="mt-1 grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-neutral-500 dark:text-neutral-400">Services</p>
                <p className="text-neutral-900 dark:text-neutral-100">{m.services}</p>
              </div>
              <div>
                <p className="text-neutral-500 dark:text-neutral-400">Products</p>
                <p className="text-neutral-900 dark:text-neutral-100">{m.products}</p>
              </div>
              <div>
                <p className="text-neutral-500 dark:text-neutral-400">Total</p>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">{m.total}</p>
              </div>
            </div>
          </div>
        ))}
        {!loading && byMonth.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400">No financial activity yet.</p>
        )}
      </div>
    </div>
  )
}
