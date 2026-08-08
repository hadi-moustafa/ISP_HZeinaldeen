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

// Editing/deleting a payment re-triggers sync_invoice_status (it fires on
// UPDATE/DELETE too, not just INSERT -- see trg_payments_sync_invoice in
// 0001_init.sql), so the invoice's status is always correctly recomputed
// from whatever payments remain. It deliberately does NOT reverse the
// auto-renew-on-paid expiry bump if a payment drops the invoice back out of
// 'paid' -- same documented behavior as deleting a payment already had
// before this UI existed (0010_auto_renew_on_paid.sql).
export async function updatePayment(
  id: string,
  input: Pick<PaymentInput, 'amount' | 'payment_date' | 'method' | 'collector_id' | 'note'>,
) {
  const { data, error } = await supabase.from('payments').update(input).eq('id', id).select().single()
  if (error) throw error
  return data as Payment
}

export async function deletePayment(id: string) {
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) throw error
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

// Single source of truth for what a subscriber owes a given period --
// their custom price override if set, else the service's sell_price, plus
// one period's carried-forward shortfall if the immediately preceding
// period was left unpaid/partial (see 0016_billing_engine.sql for the
// exact rule). The generate-monthly-invoices Edge Function calls the same
// Postgres function directly, so cron-generated and on-demand invoices are
// never computed differently.
export async function computeInvoiceAmount(subscriberId: string, periodMonth: string) {
  const { data, error } = await supabase.rpc('compute_invoice_amount', {
    p_subscriber_id: subscriberId,
    p_period_month: periodMonth,
  })
  if (error) throw error
  return data as number
}

// Bills a subscriber for a period on demand (a newly-created subscriber's
// first bill, or the subscriber list's Pay button finding no invoice yet)
// rather than leaving them with no invoice -- and no working Pay button --
// until the next monthly cron run. Goes through create_period_invoice()
// (0017_billing_engine_fix.sql), the same atomic function the cron Edge
// Function calls, so both compute amount_due (custom price + one period's
// carried-forward shortfall) and close out the invoice that shortfall came
// from identically -- never two different implementations that could
// drift apart. Safe to call when an invoice already exists for that
// period: the function's own ON CONFLICT DO NOTHING makes it a no-op,
// same as a cron re-run today.
export async function createPeriodInvoice(subscriberId: string, serviceId: string, periodMonth: string) {
  const { data, error } = await supabase.rpc('create_period_invoice', {
    p_subscriber_id: subscriberId,
    p_service_id: serviceId,
    p_period_month: periodMonth,
  })
  if (error) throw error
  return data as string | null
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
