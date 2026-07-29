export interface MonthlyLogRow {
  period_month: string
  subscriber_id: string
  subscriber_name: string
  owner_name: string | null
  default_collector_name: string | null
  amount_due: number
  amount_paid: number
  status: string
  due_date: string | null
  postponed_to: string | null
  invoice_id: string
}

export interface MonthlyFinancialRow {
  period_month: string
  revenue_type: 'services' | 'products'
  total: number
}
