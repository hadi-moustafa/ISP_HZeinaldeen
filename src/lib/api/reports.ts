import { supabase } from '../supabase'
import { fetchAllRows } from './fetchAll'
import type { MonthlyFinancialRow, MonthlyLogRow } from '../../types/reports'

export async function listMonthlyLog(periodMonth: string) {
  return fetchAllRows<MonthlyLogRow>((from, to) =>
    supabase
      .from('monthly_log')
      .select('*')
      .eq('period_month', periodMonth)
      .order('subscriber_name')
      .order('invoice_id')
      .range(from, to),
  )
}

export async function listMonthlyFinancials() {
  const { data, error } = await supabase
    .from('monthly_financials')
    .select('*')
    .order('period_month', { ascending: false })
  if (error) throw error
  return data as MonthlyFinancialRow[]
}

// Headline numbers for the dashboard, computed in one place server-side
// (dashboard_summary(), 0031_company_schedule_and_dashboard.sql) from real
// invoices. Two different questions, kept apart on purpose:
//   period*  this month's bills -- due (invoices, plus what an invoice
//            would be for anyone not billed yet), paid against them,
//            forgiven, and left
//   cash*    money actually received this month, by date, whatever it
//            paid for (old debt and advance payments included)
export interface DashboardSummary {
  periodMonth: string
  totalSubscribers: number
  billableSubscribers: number
  unbilledSubscribers: number
  periodDue: number
  periodPaid: number
  periodForgiven: number
  periodLeft: number
  paidUsers: number
  unpaidUsers: number
  overdueSubscribers: number
  overdueAmount: number
  productUnits: number
  productTotal: number
  productPaid: number
  productLeft: number
  cashSubscribers: number
  cashProducts: number
  companyPaidMonthAll: number
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { data, error } = await supabase.rpc('dashboard_summary')
  if (error) throw error
  const raw = data as Record<string, unknown>
  const num = (k: string) => Number(raw[k] ?? 0)
  return {
    periodMonth: String(raw.periodMonth),
    totalSubscribers: num('totalSubscribers'),
    billableSubscribers: num('billableSubscribers'),
    unbilledSubscribers: num('unbilledSubscribers'),
    periodDue: num('periodDue'),
    periodPaid: num('periodPaid'),
    periodForgiven: num('periodForgiven'),
    periodLeft: num('periodLeft'),
    paidUsers: num('paidUsers'),
    unpaidUsers: num('unpaidUsers'),
    overdueSubscribers: num('overdueSubscribers'),
    overdueAmount: num('overdueAmount'),
    productUnits: num('productUnits'),
    productTotal: num('productTotal'),
    productPaid: num('productPaid'),
    productLeft: num('productLeft'),
    cashSubscribers: num('cashSubscribers'),
    cashProducts: num('cashProducts'),
    companyPaidMonthAll: num('companyPaidMonthAll'),
  }
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

// What the ISP owes each company, one definition for the dashboard and the
// Company Analysis page (company_due_schedule(), 0031). Renewal dates come
// from each subscriber's billing day, not their paid-until expiry, so a
// subscriber paying early never hides what's owed to the company.
//   owedMonth     paid_price x active subscribers (standing monthly amount)
//   paidMonth     paid to the company this calendar month
//   dueSoFar      renewals whose billing day this month already passed
//   count/amount  renewals in [today, today + days]
//   have          paidMonth - dueSoFar - amount (negative = still to pay)
export interface CompanyDueRow {
  compId: string
  companyName: string
  countsInTotals: boolean
  activeSubscribers: number
  owedMonth: number
  paidMonth: number
  dueSoFar: number
  count: number
  amount: number
  have: number
}

export async function getCompanyDueSchedule(days: number): Promise<CompanyDueRow[]> {
  const { data, error } = await supabase.rpc('company_due_schedule', { p_days: days })
  if (error) throw error
  return (data as Record<string, unknown>[]).map((r) => ({
    compId: String(r.comp_id),
    companyName: String(r.company_name),
    countsInTotals: Boolean(r.counts_in_totals),
    activeSubscribers: Number(r.active_subscribers),
    owedMonth: Number(r.owed_month),
    paidMonth: Number(r.paid_month),
    dueSoFar: Number(r.due_so_far),
    count: Number(r.window_count),
    amount: Number(r.window_amount),
    have: Number(r.have),
  }))
}

// Companies with a renewal in the window, biggest first -- the dashboard's
// "Company payments due" table.
export async function getCompanyPaymentsDue(days: number): Promise<CompanyDueRow[]> {
  const rows = await getCompanyDueSchedule(days)
  return rows.filter((r) => r.count > 0).sort((a, b) => b.amount - a.amount)
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
