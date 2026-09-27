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

// Oldest-first, unpaid/partial only -- the Pay modal's Debt row pays these
// off in this order via pay_subscriber_debt_fifo(). Distinct from
// listInvoicesForSubscriber above (unfiltered/newest-first, used for
// history display) -- don't repurpose that one for FIFO payoff math.
export async function listOpenInvoicesForSubscriber(subscriberId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .in('status', ['unpaid', 'partial'])
    .order('period_month', { ascending: true })
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

// What a new invoice for this subscriber+period would be: their price
// (custom override if > 0, else the service's sell_price) plus everything
// still open from earlier months (see compute_invoice_amount, 0030) --
// exactly what create_period_invoice will bill.
export async function computeInvoiceAmount(subscriberId: string, periodMonth: string) {
  const { data, error } = await supabase.rpc('compute_invoice_amount', {
    p_subscriber_id: subscriberId,
    p_period_month: periodMonth,
  })
  if (error) throw error
  return data as number
}

// Bills a subscriber for a period on demand (a newly-created subscriber's
// first bill, or Pay finding no invoice yet) through create_period_invoice
// (0030) -- the same function the nightly generation run uses. Returns
// null, touching nothing, if that period already has an invoice.
export async function createPeriodInvoice(subscriberId: string, serviceId: string, periodMonth: string) {
  const { data, error } = await supabase.rpc('create_period_invoice', {
    p_subscriber_id: subscriberId,
    p_service_id: serviceId,
    p_period_month: periodMonth,
  })
  if (error) throw error
  return data as string | null
}

// Pays down a subscriber's older open invoices (unpaid, partial or
// postponed), oldest first (see pay_subscriber_debt_fifo, 0030). With
// beforePeriod set, only months before it are touched -- the Pay modal
// passes the current month so its Debt line never pays this month's bill.
// Returns the amount actually applied.
export async function payDebtFifo(input: {
  subscriberId: string
  amount: number
  paymentDate: string
  method: string
  note: string | null
  collectorId: string | null
  staffId: string | null
  beforePeriod: string | null
}) {
  const { data, error } = await supabase.rpc('pay_subscriber_debt_fifo', {
    p_subscriber_id: input.subscriberId,
    p_amount: input.amount,
    p_payment_date: input.paymentDate,
    p_method: input.method,
    p_note: input.note,
    p_collector_id: input.collectorId,
    p_staff_id: input.staffId,
    p_before_period: input.beforePeriod,
  })
  if (error) throw error
  return data as number
}

// Bills every active subscriber with a service who has no invoice for the
// current month yet (Beirut time). Same generate_period_invoices() the
// nightly billing-daily cron job runs, so a manual run and the cron can
// never compute anything differently; safe to re-run any time.
export async function generateMonthlyInvoices() {
  const { data, error } = await supabase.rpc('generate_period_invoices', { p_period_month: null, p_source: 'manual' })
  if (error) throw error
  return data as { periodMonth: string; created: number; skipped: number; failed: number; errors: { subscriber: string; error: string }[] }
}

export interface InvoiceGenerationRun {
  period_month: string
  source: string
  created: number
  skipped: number
  failed: number
  ran_at: string
}

export async function getLatestGenerationRun() {
  const { data, error } = await supabase
    .from('invoice_generation_runs')
    .select('period_month, source, created, skipped, failed, ran_at')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as InvoiceGenerationRun | null
}

// The Pay modal's whole Service line in one transaction (see
// pay_service_line in 0030_billing_integrity.sql): bills this month if
// needed, records the payment, and then -- depending on the choice --
// forgives the rest (msama7), records an overpayment as an advance payment
// on next month's invoice (rollover), or makes the amount the subscriber's
// new permanent price. A failure anywhere leaves nothing half-done.
export type ServiceLineChoice = 'rollover' | 'msama7' | 'skip' | null

export async function payServiceLine(input: {
  subscriberId: string
  amount: number
  choice: ServiceLineChoice
  newPrice: boolean
  paymentDate: string
  method: string
  note: string | null
  collectorId: string | null
  staffId: string | null
}) {
  const { data, error } = await supabase.rpc('pay_service_line', {
    p_subscriber_id: input.subscriberId,
    p_amount: input.amount,
    p_choice: input.choice,
    p_new_price: input.newPrice,
    p_payment_date: input.paymentDate,
    p_method: input.method,
    p_note: input.note,
    p_collector_id: input.collectorId,
    p_staff_id: input.staffId,
  })
  if (error) throw error
  return data as { invoiceId: string; applied: number; advance?: number; skipped: boolean }
}

// Open balance on invoices from months before this one -- what the Pay
// modal's Debt line is for. This month's invoice is the Service line's job,
// so it's never included here (the two lines can't show the same money).
export async function getPriorPeriodsBalance(subscriberId: string, periodMonth: string) {
  const { data, error } = await supabase
    .from('monthly_log')
    .select('amount_due, amount_paid, status')
    .eq('subscriber_id', subscriberId)
    .lt('period_month', periodMonth)
    .in('status', ['unpaid', 'partial', 'postponed'])
  if (error) throw error
  return (data as { amount_due: number; amount_paid: number }[]).reduce(
    (sum, r) => sum + Math.max(r.amount_due - r.amount_paid, 0),
    0,
  )
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
