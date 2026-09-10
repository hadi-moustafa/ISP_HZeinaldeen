import { useEffect, useMemo, useState } from 'react'
import { listCompanyDues } from '../../lib/api/companyPayments'
import type { CompanyDue } from '../../types/companyPayments'
import { cardClass } from '../../lib/uiClasses'

// "What does this company need from me" -- a read-only, at-a-glance
// breakdown of what the ISP owes each reseller company vs. what's already
// been paid, separate from the Company Payments page's payment-logging
// workflow. Sourced from the same `company_dues` view (active subscribers'
// services.paid_price, see companyPayments.ts) so the numbers here always
// match what Company Payments shows -- this page is purely a different lens
// on the same underlying totals. "Paid" is scoped to the current calendar
// month on both ends (0029) and resets automatically when the month rolls
// over -- no payment history is ever deleted, this view just stops summing
// other months in.
//
// The summary totals count only companies flagged counts_in_totals: an
// expense account like "Hsen masrouf" has no services or subscribers, so
// it can never owe anything, and folding its payments into "Paid this
// month" overstated what actually went to the real reseller companies.
// Those companies still get a card here (marked so the arithmetic reads
// correctly) and still accept payments on the Company Payments page.
export function CompanyPaymentsAnalysisPage() {
  const [dues, setDues] = useState<CompanyDue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listCompanyDues()
      .then(setDues)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load company dues'))
      .finally(() => setLoading(false))
  }, [])

  const totals = useMemo(() => {
    const counted = dues.filter((d) => d.counts_in_totals)
    const totalOwed = counted.reduce((sum, d) => sum + d.total_owed, 0)
    const totalPaid = counted.reduce((sum, d) => sum + d.total_paid, 0)
    return {
      totalOwed,
      totalPaid,
      totalBalance: Math.max(totalOwed - totalPaid, 0),
      excludedCount: dues.length - counted.length,
    }
  }, [dues])

  const sortedDues = useMemo(
    () => [...dues].sort((a, b) => b.total_owed - b.total_paid - (a.total_owed - a.total_paid)),
    [dues],
  )

  return (
    <div>
      <p className="mb-4 text-sm text-neutral-500">What each company needs from us, at a glance.</p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-neutral-500">Loading…</p>}

      {!loading && dues.length > 0 && (
        <div className={`${cardClass} mb-4 grid grid-cols-3 divide-x divide-neutral-100 p-0`}>
          <div className="px-3 py-4 text-center">
            <p className="text-xl font-bold text-neutral-900">{totals.totalOwed.toFixed(2)}</p>
            <p className="text-xs text-neutral-500">Total owed</p>
          </div>
          <div className="px-3 py-4 text-center">
            <p className="text-xl font-bold text-emerald-600">{totals.totalPaid.toFixed(2)}</p>
            <p className="text-xs text-neutral-500">Paid this month</p>
          </div>
          <div className="px-3 py-4 text-center">
            <p className="text-xl font-bold text-red-600">{totals.totalBalance.toFixed(2)}</p>
            <p className="text-xs text-neutral-500">Still owed</p>
          </div>
        </div>
      )}

      {!loading && totals.excludedCount > 0 && (
        <p className="mb-4 text-xs text-neutral-500">
          This month only. {totals.excludedCount} account
          {totals.excludedCount > 1 ? 's are' : ' is'} shown below but left out of these totals — change that
          per company in Admin → Companies.
        </p>
      )}

      <div className="space-y-3">
        {sortedDues.map((due) => {
          const balance = due.total_owed - due.total_paid
          const pctPaid = due.total_owed > 0 ? Math.min(Math.max(due.total_paid / due.total_owed, 0), 1) : 1
          const settled = balance <= 0
          return (
            <div key={due.comp_id} className={cardClass}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-semibold text-neutral-900">{due.company_name}</p>
                  {!due.counts_in_totals && (
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                      not in totals
                    </span>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    settled ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {settled ? 'Settled' : `Owes ${balance.toFixed(2)}`}
                </span>
              </div>

              <div className="mb-2 h-2.5 w-full overflow-hidden rounded-full bg-red-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pctPaid * 100}%` }} />
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-neutral-50 px-2 py-2">
                  <p className="text-sm font-semibold text-neutral-900">{due.total_owed.toFixed(2)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400">Owed</p>
                </div>
                <div className="rounded-lg bg-neutral-50 px-2 py-2">
                  <p className="text-sm font-semibold text-emerald-600">{due.total_paid.toFixed(2)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400">Paid this month</p>
                </div>
                <div className="rounded-lg bg-neutral-50 px-2 py-2">
                  <p className={`text-sm font-semibold ${balance > 0 ? 'text-red-600' : 'text-neutral-900'}`}>
                    {Math.max(balance, 0).toFixed(2)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400">Balance</p>
                </div>
              </div>
            </div>
          )
        })}
        {!loading && dues.length === 0 && <p className="text-neutral-500">No companies yet.</p>}
      </div>
    </div>
  )
}
