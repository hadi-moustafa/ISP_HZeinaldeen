import { useEffect, useState } from 'react'
import { useStaff } from '../context/StaffContext'
import { isAdmin } from '../lib/permissions'
import { generateMonthlyInvoices } from '../lib/api/invoices'
import { getDashboardSummary, getExpiryWatch, listMonthlyLog, type DashboardSummary, type ExpiryBucket } from '../lib/api/reports'
import { listSubscribers } from '../lib/api/subscribers'
import { listServices } from '../lib/api/services'
import { listCollectors } from '../lib/api/collectors'
import { emptyFilters } from '../types/subscribers'
import type { SubscriberWithRelations } from '../types/subscribers'
import type { ServiceWithCompany } from '../types/reference'
import type { Collector } from '../types/reference'
import type { MonthlyLogRow } from '../types/reports'
import { AppHeader } from '../components/AppHeader'
import { PaymentModal } from '../components/subscriber/PaymentModal'
import { primaryButtonClass, cardClass, inputClass } from '../lib/uiClasses'
import { Search, Banknote } from 'lucide-react'

function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function currentMonthLabel() {
  return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function statusDotColor(log: MonthlyLogRow | undefined, debt: number): string {
  if (log?.status === 'partial') return 'bg-orange-500'
  if (debt > 0) return 'bg-red-500'
  if (log?.status === 'paid' || log?.status === 'waived') return 'bg-emerald-500'
  if (log?.status === 'postponed') return 'bg-orange-500'
  return 'bg-neutral-300'
}

export function DashboardPage() {
  const { staff } = useStaff()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [expiryWatch, setExpiryWatch] = useState<ExpiryBucket[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<SubscriberWithRelations[]>([])
  const [searching, setSearching] = useState(false)

  const [services, setServices] = useState<ServiceWithCompany[]>([])
  const [collectors, setCollectors] = useState<Collector[]>([])
  const [monthlyLogBySubscriber, setMonthlyLogBySubscriber] = useState<Record<string, MonthlyLogRow>>({})

  const [paymentSub, setPaymentSub] = useState<SubscriberWithRelations | null>(null)

  function refreshStats() {
    getDashboardSummary(currentPeriodMonth())
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
    getExpiryWatch()
      .then(setExpiryWatch)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load expiry watch'))
    listMonthlyLog(currentPeriodMonth())
      .then((rows) => setMonthlyLogBySubscriber(Object.fromEntries(rows.map((row) => [row.subscriber_id, row]))))
      .catch(() => {})
  }

  useEffect(() => {
    refreshStats()
    listServices().then(setServices).catch(() => {})
    listCollectors().then(setCollectors).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const timer = setTimeout(() => {
      listSubscribers({ ...emptyFilters, search: searchTerm }, null, 'name')
        .then((rows) => {
          if (!cancelled) setSearchResults(rows)
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
  }, [searchTerm])

  async function handleGenerateInvoices() {
    setGenerating(true)
    setGenerateResult(null)
    try {
      const result = await generateMonthlyInvoices()
      setGenerateResult(`Created ${result.created}, skipped ${result.skipped}.`)
      refreshStats()
    } catch (err) {
      setGenerateResult(err instanceof Error ? err.message : 'Failed to generate invoices')
    } finally {
      setGenerating(false)
    }
  }

  function SubscriberRow({ sub }: { sub: SubscriberWithRelations }) {
    const log = monthlyLogBySubscriber[sub.id]
    return (
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(log, sub.debt)}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">{sub.name}</p>
          <p className="truncate text-xs text-neutral-500">
            {sub.services?.companies?.name ?? '—'}
            {sub.expiry_date ? ` · exp ${new Date(sub.expiry_date + 'T00:00:00').getUTCDate()}` : ''}
          </p>
        </div>
        <button
          onClick={() => setPaymentSub(sub)}
          title="Log a payment"
          className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Banknote size={14} />
          Pay
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader>
        <main className="p-3">
          <h1 className="mb-0.5 text-lg font-semibold text-neutral-900">Dashboard</h1>
          <p className="mb-3 text-sm text-neutral-500">{currentMonthLabel()}</p>

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          {/* Search + instant pay */}
          <div className="relative mb-3">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search subscriber by name…"
              className={`${inputClass} pl-9`}
            />
          </div>
          {searchTerm.trim() && (
            <div className="mb-4 space-y-1.5">
              {searching && <p className="text-xs text-neutral-400">Searching…</p>}
              {!searching && searchResults.length === 0 && (
                <p className="text-xs text-neutral-400">No subscribers match.</p>
              )}
              {searchResults.map((sub) => (
                <SubscriberRow key={sub.id} sub={sub} />
              ))}
            </div>
          )}

          {summary && (
            <>
              {/* Hero: total collected this period, services + products */}
              <div className={`${cardClass} mb-3`}>
                <p className="text-xs text-neutral-500">Total collected this period</p>
                <p className="text-3xl font-bold text-emerald-600">{summary.totalPaymentsCollected.toFixed(2)}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  Services {summary.totalPaid.toFixed(2)} · Products {summary.totalPaymentsProducts.toFixed(2)}
                </p>
              </div>

              {/* Dense stat grid */}
              <div className="mb-4 grid grid-cols-2 gap-2">
                <div className={cardClass}>
                  <p className="text-xl font-bold text-neutral-900">{summary.totalSubscribers}</p>
                  <p className="text-xs text-neutral-500">Total subscribers</p>
                </div>
                <div className={cardClass}>
                  <p className="text-xl font-bold text-red-600">{summary.totalDebtSubscribers}</p>
                  <p className="text-xs text-neutral-500">Subscribers in debt</p>
                </div>
                <div className={cardClass}>
                  <p className="text-xl font-bold text-neutral-900">{summary.totalSoldServices}</p>
                  <p className="text-xs text-neutral-500">Total sold services</p>
                </div>
                <div className={cardClass}>
                  <p className="text-xl font-bold text-emerald-600">{summary.paidUsers}</p>
                  <p className="text-xs text-neutral-500">Paid users</p>
                </div>
                <div className={cardClass}>
                  <p className="text-xl font-bold text-red-600">{summary.unpaidUsers}</p>
                  <p className="text-xs text-neutral-500">Unpaid users</p>
                </div>
                <div className={cardClass}>
                  <p className="text-xl font-bold text-neutral-900">{summary.totalSoldProducts}</p>
                  <p className="text-xs text-neutral-500">Total sold products</p>
                </div>
                <div className={`${cardClass} col-span-2`}>
                  <p className="text-xl font-bold text-emerald-600">{summary.totalPaymentsProducts.toFixed(2)}</p>
                  <p className="text-xs text-neutral-500">Total payments for products</p>
                </div>
              </div>
            </>
          )}

          {!summary && !error && <p className="mb-3 text-sm text-neutral-500">Loading…</p>}

          {/* Expiring soon -- who to go collect from */}
          {expiryWatch && (
            <div className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-neutral-900">Expiring soon</h2>
              <div className="space-y-3">
                {expiryWatch.map((bucket) => (
                  <div key={bucket.date}>
                    <p className="mb-1 text-xs font-medium text-neutral-500">{bucket.label}</p>
                    {bucket.subscribers.length === 0 ? (
                      <p className="text-xs text-neutral-400">None</p>
                    ) : (
                      <div className="space-y-1.5">
                        {bucket.subscribers.map((sub) => (
                          <SubscriberRow key={sub.id} sub={sub} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-company payment alerts */}
          {expiryWatch && (
            <div className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-neutral-900">Company payments due</h2>
              <div className="space-y-3">
                {expiryWatch.map((bucket) => (
                  <div key={bucket.date}>
                    <p className="mb-1 text-xs font-medium text-neutral-500">{bucket.label}</p>
                    {bucket.companyTotals.length === 0 ? (
                      <p className="text-xs text-neutral-400">None</p>
                    ) : (
                      <div className={`${cardClass} space-y-1.5`}>
                        {bucket.companyTotals.map((ct) => (
                          <div key={ct.companyName} className="flex items-center justify-between text-sm">
                            <span className="text-neutral-700">{ct.companyName}</span>
                            <span className="font-semibold text-neutral-900">{ct.amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
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
