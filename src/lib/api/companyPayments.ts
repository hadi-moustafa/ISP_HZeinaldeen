import { supabase } from '../supabase'
import type { CompanyDue, CompanyPayment } from '../../types/companyPayments'

export async function listCompanyDues() {
  const { data, error } = await supabase.from('company_dues').select('*').order('company_name')
  if (error) throw error
  return data as CompanyDue[]
}

export async function listCompanyPayments(compId: string) {
  const { data, error } = await supabase
    .from('company_payments')
    .select('*')
    .eq('comp_id', compId)
    .order('payment_date', { ascending: false })
  if (error) throw error
  return data as CompanyPayment[]
}

export interface CompanyPaymentInput {
  comp_id: string
  amount: number
  payment_date: string
  note: string | null
  staff_id: string | null
}

export async function createCompanyPayment(input: CompanyPaymentInput) {
  const { data, error } = await supabase.from('company_payments').insert(input).select().single()
  if (error) throw error
  return data as CompanyPayment
}
