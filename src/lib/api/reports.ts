import { supabase } from '../supabase'
import { listDebtSubscriberIds } from './subscribers'
import type { MonthlyFinancialRow, MonthlyLogRow } from '../../types/reports'

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
  totalDebtSubscribers: number
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
export async function getDashboardSummary(periodMonth: string): Promise<DashboardSummary> {
  const [countRes, expectedRes, logRows, debtIds] = await Promise.all([
    supabase.from('subscribers').select('id', { count: 'exact', head: true }),
    supabase
      .from('subscribers')
      .select('services(sell_price)')
      .eq('connection_status', 'active')
      .not('service_id', 'is', null),
    listMonthlyLog(periodMonth),
    listDebtSubscriberIds(),
  ])
  if (countRes.error) throw countRes.error
  if (expectedRes.error) throw expectedRes.error

  const totalDue = (expectedRes.data as unknown as { services: { sell_price: number } | null }[]).reduce(
    (sum, r) => sum + (r.services?.sell_price ?? 0),
    0,
  )
  const totalPaid = logRows.reduce((sum, r) => sum + r.amount_paid, 0)

  return {
    totalSubscribers: countRes.count ?? 0,
    totalDue,
    totalPaid,
    totalLeft: Math.max(totalDue - totalPaid, 0),
    totalDebtSubscribers: debtIds.size,
  }
}
