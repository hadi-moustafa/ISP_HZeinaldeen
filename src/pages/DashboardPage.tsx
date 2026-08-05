import { useEffect, useState } from 'react'
import { useStaff } from '../context/StaffContext'
import { isAdmin } from '../lib/permissions'
import { generateMonthlyInvoices } from '../lib/api/invoices'
import { getDashboardSummary, type DashboardSummary } from '../lib/api/reports'
import { AppHeader } from '../components/AppHeader'
import { DonutChart } from '../components/DonutChart'
import { primaryButtonClass, cardClass } from '../lib/uiClasses'

function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function currentMonthLabel() {
  return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function DashboardPage() {
  const { staff } = useStaff()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)

  useEffect(() => {
    getDashboardSummary(currentPeriodMonth())
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
  }, [])

  async function handleGenerateInvoices() {
    setGenerating(true)
    setGenerateResult(null)
    try {
      const result = await generateMonthlyInvoices()
      setGenerateResult(`Created ${result.created}, skipped ${result.skipped}.`)
      setSummary(await getDashboardSummary(currentPeriodMonth()))
    } catch (err) {
      setGenerateResult(err instanceof Error ? err.message : 'Failed to generate invoices')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader>
        <main className="p-4">
          <h1 className="mb-1 text-lg font-semibold text-neutral-900">Dashboard</h1>
          <p className="mb-4 text-sm text-neutral-500">{currentMonthLabel()}</p>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          {!summary && !error && <p className="text-sm text-neutral-500">Loading…</p>}

          {summary && (
            <>
              <div className={`${cardClass} mb-3 flex items-center gap-5`}>
                <DonutChart
                  segments={[
                    { label: 'Collected', value: summary.totalPaid, color: '#10b981' },
                    { label: 'Left to collect', value: summary.totalLeft, color: '#f43f5e' },
                  ]}
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="text-xs text-neutral-500">Left to collect</p>
                    <p className="text-2xl font-bold text-rose-600">{summary.totalLeft.toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex items-center gap-1.5 text-neutral-600">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      Collected {summary.totalPaid.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex items-center gap-1.5 text-neutral-600">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                      Amount still to be collected {summary.totalLeft.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className={cardClass}>
                  <p className="text-2xl font-bold text-neutral-900">{summary.totalSubscribers}</p>
                  <p className="text-xs text-neutral-500">Total subscribers</p>
                </div>
                <div className={cardClass}>
                  <p className="text-2xl font-bold text-emerald-600">{summary.totalPaid.toFixed(2)}</p>
                  <p className="text-xs text-neutral-500">Collected this month</p>
                </div>
                <div className={`${cardClass} col-span-2`}>
                  <p className="text-2xl font-bold text-black">{summary.totalDebtSubscribers}</p>
                  <p className="text-xs text-neutral-500">Subscribers in debt</p>
                </div>
              </div>
            </>
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
    </div>
  )
}
