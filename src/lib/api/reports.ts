import { supabase } from '../supabase'
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
}

// Collected/left figures are for the current billing month, matching the
// monthly_log semantics used everywhere else in the app (subscriber list,
// monthly log page) rather than an all-time total.
export async function getDashboardSummary(periodMonth: string): Promise<DashboardSummary> {
  const [countRes, logRows] = await Promise.all([
    supabase.from('subscribers').select('id', { count: 'exact', head: true }),
    listMonthlyLog(periodMonth),
  ])
  if (countRes.error) throw countRes.error

  const totalDue = logRows.reduce((sum, r) => sum + r.amount_due, 0)
  const totalPaid = logRows.reduce((sum, r) => sum + r.amount_paid, 0)

  return {
    totalSubscribers: countRes.count ?? 0,
    totalDue,
    totalPaid,
    totalLeft: Math.max(totalDue - totalPaid, 0),
  }
}
