import { supabase } from '../supabase'
import { listDebtSubscriberIds, listSubscribersByExpiryRange } from './subscribers'
import type { MonthlyFinancialRow, MonthlyLogRow } from '../../types/reports'
import type { SubscriberWithRelations } from '../../types/subscribers'

export async function listMonthlyLog(periodMonth: string) {
  const { data, error } = await supabase
    .from('monthly_log')
    .select('*')
    .eq('period_month', periodMonth)
    .order('subscriber_name')
  if (error) throw error
  return data as MonthlyLogRow[]
}

export async function listMonthlyFinancials() {
  const { data, error } = await supabase
    .from('monthly_financials')
    .select('*')
    .order('period_month', { ascending: false })
  if (error) throw error
  return data as MonthlyFinancialRow[]
}

export interface DashboardSummary {
  totalSubscribers: number
  totalDue: number
  totalPaid: number
  totalLeft: number
  totalLeftProducts: number
  totalDebtSubscribers: number
  paidUsers: number
  unpaidUsers: number
  totalSoldProducts: number
  totalPaymentsProducts: number
  totalPaymentsCollected: number
}

// totalDue is the total sell price across every active subscriber with a
// service assigned -- what should be collected this month if everyone
// paid -- not the sum of invoices actually generated so far (a
// mid-month-created subscriber with no invoice yet still counts). Matches
// invoice generation's own active-only, has-a-service scoping elsewhere in
// the app. totalPaid still comes from monthly_log (this month's actual
// collections). totalDebtSubscribers reuses listDebtSubscriberIds() (any
// unpaid/partial invoice, any period) so "in debt" means the same thing
// here as it does on the subscriber list's Debt filter chip.
//
// paidUsers is counted among subscribers that already have a monthly_log
// row this period -- paid/waived count as paid, same split billingKeyFor()
// uses on the subscriber list. unpaidUsers is everyone else (total
// subscribers minus paid), explicit client definition -- so it also
// captures subscribers not yet billed this period, not just
// unpaid/partial/postponed invoice rows.
//
// totalSoldProducts/totalPaymentsProducts/totalLeftProducts only look at
// this month's 'sale' movements. Movements marked payment_status='partial'
// are excluded from both totalPaymentsProducts and totalLeftProducts (but
// still counted in totalSoldProducts) since product_movements only has a
// paid/unpaid/partial flag, not an amount-collected ledger like subscriber
// payments -- there's no way to know how much of a partial sale was
// actually collected, or how much of it is still owed. Known limitation,
// not solved here.
export async function getDashboardSummary(periodMonth: string): Promise<DashboardSummary> {
  const monthStart = periodMonth.slice(0, 8) + '01'
  const nextMonthStart = (() => {
    const d = new Date(monthStart + 'T00:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + 1)
    return d.toISOString().slice(0, 10)
  })()

  const [countRes, expectedRes, logRows, debtIds, saleMovementsRes] = await Promise.all([
    supabase.from('subscribers').select('id', { count: 'exact', head: true }),
    supabase
      .from('subscribers')
      .select('services(sell_price)')
      .eq('connection_status', 'active')
      .not('service_id', 'is', null),
    listMonthlyLog(periodMonth),
    listDebtSubscriberIds(),
    supabase
      .from('product_movements')
      .select('quantity, unit_price, payment_status')
      .eq('movement_type', 'sale')
      .gte('movement_date', monthStart)
      .lt('movement_date', nextMonthStart),
  ])
  if (countRes.error) throw countRes.error
  if (expectedRes.error) throw expectedRes.error
  if (saleMovementsRes.error) throw saleMovementsRes.error

  const expectedRows = expectedRes.data as unknown as { services: { sell_price: number } | null }[]
  const totalDue = expectedRows.reduce((sum, r) => sum + (r.services?.sell_price ?? 0), 0)
  const totalPaid = logRows.reduce((sum, r) => sum + r.amount_paid, 0)

  const paidUsers = logRows.filter((r) => r.status === 'paid' || r.status === 'waived').length
  const unpaidUsers = (countRes.count ?? 0) - paidUsers

  const saleMovements = saleMovementsRes.data as unknown as {
    quantity: number
    unit_price: number
    payment_status: string
  }[]
  const totalSoldProducts = saleMovements.reduce((sum, m) => sum + Math.abs(m.quantity), 0)
  const totalPaymentsProducts = saleMovements
    .filter((m) => m.payment_status === 'paid')
    .reduce((sum, m) => sum + Math.abs(m.quantity) * m.unit_price, 0)
  const totalLeftProducts = saleMovements
    .filter((m) => m.payment_status === 'unpaid')
    .reduce((sum, m) => sum + Math.abs(m.quantity) * m.unit_price, 0)

  return {
    totalSubscribers: countRes.count ?? 0,
    totalDue,
    totalPaid,
    totalLeft: Math.max(totalDue - totalPaid, 0),
    totalLeftProducts,
    totalDebtSubscribers: debtIds.size,
    paidUsers,
    unpaidUsers,
    totalSoldProducts,
    totalPaymentsProducts,
    totalPaymentsCollected: totalPaid + totalPaymentsProducts,
  }
}

export interface ExpiryBucket {
  date: string
  label: string
  subscribers: SubscriberWithRelations[]
  companyTotals: { companyName: string; amount: number; count: number }[]
}

function localDateString(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface CollectionRangeTotal {
  days: number
  count: number
  amount: number
}

async function collectionTotalForRange(fromDate: string, toDate: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('subscriber_id, amount')
    .gte('payment_date', fromDate)
    .lte('payment_date', toDate)
  if (error) throw error
  const rows = data as { subscriber_id: string; amount: number }[]
  return {
    count: new Set(rows.map((r) => r.subscriber_id)).size,
    amount: rows.reduce((sum, r) => sum + r.amount, 0),
  }
}

// Cumulative total, not exact-day snapshots -- "how many subscribers paid,
// and how much, across the last N days combined" for an admin-selectable N
// (1-30, clamped defensively since this feeds a date range query). N=1
// means today only.
export async function getCollectionTotal(days: number): Promise<CollectionRangeTotal> {
  const clampedDays = Math.min(Math.max(Math.trunc(days), 1), 30)
  const fromDate = localDateString(-(clampedDays - 1))
  const toDate = localDateString(0)
  const { count, amount } = await collectionTotalForRange(fromDate, toDate)
  return { days: clampedDays, count, amount }
}

// Today only -- distinct from getCollectionTotal's backward-looking N-day
// range.
export async function getCollectionTodayTotal(): Promise<CollectionRangeTotal> {
  const today = localDateString(0)
  const { count, amount } = await collectionTotalForRange(today, today)
  return { days: 1, count, amount }
}

// Cumulative windows, not exact-day snapshots -- "Today" covers today
// only, "In 2 days" merges today + tomorrow, "In 5 days" covers today
// through +5, each (after "Today") a running sum rather than just the
// count landing on that one exact day. Single fetch (widest window)
// drives both the "expiring soon, go collect" subscriber list and the
// per-company "what we owe them" alert, grouping the same rows two
// different ways.
export async function getExpiryWatch(): Promise<ExpiryBucket[]> {
  const windows = [
    { toOffset: 0, label: 'Today' },
    { toOffset: 1, label: 'In 2 days' },
    { toOffset: 5, label: 'In 5 days' },
  ]
  const fromDate = localDateString(0)
  const widestToDate = localDateString(windows[windows.length - 1].toOffset)
  const rows = await listSubscribersByExpiryRange(fromDate, widestToDate)

  return windows.map((w) => {
    const toDate = localDateString(w.toOffset)
    const subscribers = rows.filter(
      (r) => r.expiry_date !== null && r.expiry_date >= fromDate && r.expiry_date <= toDate,
    )
    const byCompany = new Map<string, { amount: number; count: number }>()
    for (const sub of subscribers) {
      const companyName = sub.services?.companies?.name
      if (!companyName) continue
      const owed = sub.services?.paid_price ?? 0
      const entry = byCompany.get(companyName) ?? { amount: 0, count: 0 }
      entry.amount += owed
      entry.count += 1
      byCompany.set(companyName, entry)
    }
    return {
      date: toDate,
      label: w.label,
      subscribers,
      companyTotals: Array.from(byCompany.entries()).map(([companyName, v]) => ({ companyName, ...v })),
    }
  })
}

// Flat, admin-selectable-range list of subscribers expiring within [today,
// today+days] -- feeds the "Expiring soon" list, independent of the fixed
// Today/In-2-days/In-5-days urgency tiles above it.
export async function getExpiringSubscribers(days: number): Promise<SubscriberWithRelations[]> {
  const clampedDays = Math.min(Math.max(Math.trunc(days), 1), 30)
  const fromDate = localDateString(0)
  const toDate = localDateString(clampedDays)
  const rows = await listSubscribersByExpiryRange(fromDate, toDate)
  return [...rows].sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? ''))
}

export interface CompanyDueRow {
  companyName: string
  count: number
  amount: number
}

// Per-company breakdown of what's owed for subscribers expiring within
// [today, today+days] -- backs the "Company payments due" table, adaptive
// to however many companies actually have subscribers in range and to any
// admin-selected day range (not just the fixed 5-day window).
export async function getCompanyPaymentsDue(days: number): Promise<CompanyDueRow[]> {
  const clampedDays = Math.min(Math.max(Math.trunc(days), 1), 30)
  const fromDate = localDateString(0)
  const toDate = localDateString(clampedDays)
  const rows = await listSubscribersByExpiryRange(fromDate, toDate)
  const byCompany = new Map<string, CompanyDueRow>()
  for (const sub of rows) {
    const companyName = sub.services?.companies?.name
    if (!companyName) continue
    const owed = sub.services?.paid_price ?? 0
    const entry = byCompany.get(companyName) ?? { companyName, count: 0, amount: 0 }
    entry.count += 1
    entry.amount += owed
    byCompany.set(companyName, entry)
  }
  return Array.from(byCompany.values()).sort((a, b) => b.amount - a.amount)
}

export interface CollectedSubscriber {
  subscriberId: string
  name: string
  amount: number
}

// Who was actually collected from today, and how much -- backs the reveal
// arrow on the Collected card's "today" tile.
export async function getCollectionTodaySubscribers(): Promise<CollectedSubscriber[]> {
  const today = localDateString(0)
  const { data, error } = await supabase
    .from('payments')
    .select('subscriber_id, amount, subscribers(name)')
    .gte('payment_date', today)
    .lte('payment_date', today)
  if (error) throw error
  const rows = data as unknown as { subscriber_id: string; amount: number; subscribers: { name: string } | null }[]
  const bySubscriber = new Map<string, CollectedSubscriber>()
  for (const row of rows) {
    const existing = bySubscriber.get(row.subscriber_id)
    if (existing) {
      existing.amount += row.amount
    } else {
      bySubscriber.set(row.subscriber_id, {
        subscriberId: row.subscriber_id,
        name: row.subscribers?.name ?? 'Unknown',
        amount: row.amount,
      })
    }
  }
  return Array.from(bySubscriber.values()).sort((a, b) => a.name.localeCompare(b.name))
}
