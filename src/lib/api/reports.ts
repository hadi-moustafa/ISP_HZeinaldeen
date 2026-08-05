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

// Collected/left figures are for the current billing month, matching the
// monthly_log semantics used everywhere else in the app (subscriber list,
// monthly log page) rather than an all-time total. totalDebtSubscribers
// reuses listDebtSubscriberIds() (any unpaid/partial invoice, any period)
// so "in debt" means the same thing here as it does on the subscriber
// list's Debt filter chip -- not scoped to the current month like the
// other figures.
export async function getDashboardSummary(periodMonth: string): Promise<DashboardSummary> {
  const [countRes, logRows, debtIds] = await Promise.all([
    supabase.from('subscribers').select('id', { count: 'exact', head: true }),
    listMonthlyLog(periodMonth),
    listDebtSubscriberIds(),
  ])
  if (countRes.error) throw countRes.error

  const totalDue = logRows.reduce((sum, r) => sum + r.amount_due, 0)
  const totalPaid = logRows.reduce((sum, r) => sum + r.amount_paid, 0)

  return {
    totalSubscribers: countRes.count ?? 0,
    totalDue,
    totalPaid,
    totalLeft: Math.max(totalDue - totalPaid, 0),
    totalDebtSubscribers: debtIds.size,
  }
}
