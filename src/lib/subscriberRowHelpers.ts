import { postponeInvoice, createPeriodInvoice } from './api/invoices'
import { listMonthlyLog } from './api/reports'
import type { SubscriberWithRelations } from '../types/subscribers'
import type { MonthlyLogRow } from '../types/reports'

// Shared by the dashboard's search results and the subscriber list (see
// components/subscriber/SubscriberRow.tsx).

export function currentPeriodMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

export function statusDotColor(log: MonthlyLogRow | undefined, debt: number): string {
  if (log?.status === 'partial') return 'bg-orange-500'
  if (debt > 0) return 'bg-red-500'
  if (log?.status === 'paid' || log?.status === 'waived') return 'bg-emerald-500'
  if (log?.status === 'postponed') return 'bg-orange-500'
  return 'bg-neutral-300'
}

// Expiry is shown (and sorted) as day-of-month only -- billing is anchored
// to a day, not a date. getUTCDate() on the DATE string, never getDate(),
// which shifts a day west of UTC.
export function expiryDay(expiryDate: string | null): number | null {
  return expiryDate ? new Date(expiryDate + 'T00:00:00Z').getUTCDate() : null
}

// Smallest expiry day first (client instruction: every list reads smallest
// to largest), no-expiry subscribers last, ties broken by name.
export function compareByExpiryDay(a: SubscriberWithRelations, b: SubscriberWithRelations): number {
  const aDay = expiryDay(a.expiry_date)
  const bDay = expiryDay(b.expiry_date)
  if (aDay !== bDay) {
    if (aDay === null) return 1
    if (bDay === null) return -1
    return aDay - bDay
  }
  return a.name.localeCompare(b.name)
}

// Quick postpone -- days-from-now rather than an absolute date, per
// explicit ask ("how much will this user be postponed... make it in
// days"). Creates the current period's invoice on demand first if one
// doesn't exist yet (same on-demand pattern PaymentModal uses), since
// postpone_invoice needs a real invoice row to act on. Returns true if a
// postponement was actually saved, so the caller knows to refresh.
export async function quickPostpone(
  sub: SubscriberWithRelations,
  log: MonthlyLogRow | undefined,
  staffId: string | null,
  source: string,
): Promise<boolean> {
  const daysStr = window.prompt(`Postpone ${sub.name}'s payment by how many days?`)
  if (!daysStr) return false
  const days = Number(daysStr)
  if (!Number.isFinite(days) || days <= 0) {
    window.alert('Enter a whole number of days greater than 0.')
    return false
  }
  if (!log && sub.service_id) {
    const period = currentPeriodMonth()
    await createPeriodInvoice(sub.id, sub.service_id, period)
    const rows = await listMonthlyLog(period)
    log = rows.find((row) => row.subscriber_id === sub.id)
  }
  if (!log?.invoice_id) {
    window.alert('This subscriber has no billable invoice to postpone.')
    return false
  }
  // Local getters/setters throughout -- never toISOString() for a
  // date-only value, since it converts to UTC first and silently rolls
  // the date back a day anywhere east of UTC (the same class of bug
  // the Excel importer hit; see formatDateLocal in lib/api/import.ts).
  const base = log.due_date ? new Date(`${log.due_date}T00:00:00`) : new Date()
  base.setDate(base.getDate() + days)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  await postponeInvoice(log.invoice_id, `${y}-${m}-${d}`, `Postponed ${days} day(s) from the ${source}`, staffId)
  return true
}
