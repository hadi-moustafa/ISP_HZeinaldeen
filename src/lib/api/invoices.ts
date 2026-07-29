import { supabase } from '../supabase'
import type {
  Invoice,
  InvoiceReceipt,
  Payment,
  PaymentWithCollector,
  ReceiptPayment,
} from '../../types/invoices'

export async function listInvoicesForSubscriber(subscriberId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .order('period_month', { ascending: false })
  if (error) throw error
  return data as Invoice[]
}

export async function listPaymentsForInvoice(invoiceId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('*, collectors(name)')
    .eq('invoice_id', invoiceId)
    .order('payment_date', { ascending: false })
  if (error) throw error
  return data as unknown as PaymentWithCollector[]
}

export interface PaymentInput {
  invoice_id: string | null
  subscriber_id: string
  collector_id: string | null
  amount: number
  payment_date: string
  method: string
  note: string | null
  staff_id: string | null
}

export async function createPayment(input: PaymentInput) {
  const { data, error } = await supabase.from('payments').insert(input).select().single()
  if (error) throw error
  return data as Payment
}

export async function postponeInvoice(
  invoiceId: string,
  newDueDate: string,
  reason: string | null,
  staffId: string | null,
) {
  const { error } = await supabase.rpc('postpone_invoice', {
    p_invoice_id: invoiceId,
    p_new_due_date: newDueDate,
    p_reason: reason,
    p_staff_id: staffId,
  })
  if (error) throw error
}

export async function generateMonthlyInvoices() {
  const { data, error } = await supabase.functions.invoke('generate-monthly-invoices')
  if (error) throw error
  return data
}

// Public/unauthenticated lookup for the shareable receipt page. Safe under
// v1's intentionally-open RLS since the invoice UUID is unguessable; revisit
// once RLS is tightened (see schema_v2.sql's note on that).
export async function getInvoiceReceipt(invoiceId: string) {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, subscribers(name, phone), services(name, companies(name))')
    .eq('id', invoiceId)
    .single()
  if (error) throw error

  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('amount, payment_date, method')
    .eq('invoice_id', invoiceId)
    .order('payment_date', { ascending: false })
  if (paymentsError) throw paymentsError

  return {
    invoice: invoice as unknown as InvoiceReceipt,
    payments: (payments ?? []) as ReceiptPayment[],
  }
}
