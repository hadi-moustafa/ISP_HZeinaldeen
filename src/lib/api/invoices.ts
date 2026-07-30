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

// "Mark as debt" flow: doubles what the subscriber owes for next month as a
// late-payment penalty, per explicit client instruction. Never touches the
// current invoice (already unpaid/red on its own) -- only next period's.
// If next month's invoice already exists (e.g. from the monthly cron) and
// isn't paid yet, its amount is raised to double; if it doesn't exist yet,
// it's created early. Once that doubled invoice is paid, the month after
// reverts to the normal price automatically -- nothing here changes the
// service's price, just this one invoice row.
export async function doubleNextMonthInvoice(
  subscriberId: string,
  serviceId: string,
  nextPeriodMonth: string,
  doubledAmount: number,
) {
  const { data: existing, error: findError } = await supabase
    .from('invoices')
    .select('id, status')
    .eq('subscriber_id', subscriberId)
    .eq('period_month', nextPeriodMonth)
    .maybeSingle()
  if (findError) throw findError

  if (existing) {
    if (existing.status === 'paid') return
    const { error } = await supabase
      .from('invoices')
      .update({ amount_due: doubledAmount })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('invoices').insert({
      subscriber_id: subscriberId,
      service_id: serviceId,
      period_month: nextPeriodMonth,
      amount_due: doubledAmount,
      status: 'unpaid',
    })
    if (error) throw error
  }
}

// Bills a newly-created active subscriber for the current period immediately,
// rather than leaving them with no invoice (and therefore no working Pay
// button) until the next monthly cron run. Safe to double-generate later:
// invoices has UNIQUE(subscriber_id, period_month), so the cron's own
// insert attempt for this same subscriber+period just hits 23505 and is
// skipped, exactly like a manual re-run of the cron already is.
export async function createInvoice(input: {
  subscriber_id: string
  service_id: string
  period_month: string
  amount_due: number
}) {
  const { error } = await supabase.from('invoices').insert({ ...input, due_date: input.period_month })
  if (error && error.code !== '23505') throw error
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
