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
  collected_at: string | null
  service_id: string | null
  company_id: string | null
  service_name: string | null
  company_name: string | null
  owner_id: string | null
  collector_id: string | null
}

export interface MonthlyFinancialRow {
  period_month: string
  revenue_type: 'services' | 'products'
  total: number
}
