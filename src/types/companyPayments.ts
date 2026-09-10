export interface CompanyDue {
  comp_id: string
  company_name: string
  total_owed: number
  total_paid: number
  // False for expense accounts that aren't reseller companies (no
  // services, no subscribers, so total_owed is permanently 0). They still
  // show on the analysis page and still accept logged payments -- they
  // just don't feed its summary totals. Toggled in Admin > Companies.
  counts_in_totals: boolean
}

export interface CompanyPayment {
  id: string
  comp_id: string
  amount: number
  payment_date: string
  note: string | null
  staff_id: string | null
  created_at: string
}
