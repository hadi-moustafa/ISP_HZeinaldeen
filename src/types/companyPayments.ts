export interface CompanyDue {
  comp_id: string
  company_name: string
  total_owed: number
  total_paid: number
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
