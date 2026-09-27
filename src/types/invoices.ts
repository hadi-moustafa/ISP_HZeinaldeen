export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'postponed' | 'waived'

// Why an invoice is 'waived': forgiven (msama7) or rolled_over (its balance
// moved into a later month's invoice). See 0030_billing_integrity.sql.
export type WaiveReason = 'forgiven' | 'rolled_over'

// What to call an invoice's status on screen -- 'waived' alone can't tell
// forgiven money from money that's still owed on a later invoice.
export function invoiceStatusLabel(status: InvoiceStatus | string, waiveReason?: WaiveReason | null): string {
  if (status === 'waived') return waiveReason === 'rolled_over' ? 'moved to next month' : 'forgiven'
  return status
}

export interface Invoice {
  id: string
  subscriber_id: string
  service_id: string | null
  period_month: string
  amount_due: number
  due_date: string | null
  postponed_to: string | null
  status: InvoiceStatus
  waive_reason: WaiveReason | null
  forgiven_amount: number | null
  created_at: string
  updated_at: string
}

export interface Payment {
  id: string
  invoice_id: string | null
  subscriber_id: string
  collector_id: string | null
  amount: number
  payment_date: string
  method: string
  note: string | null
  staff_id: string | null
  created_at: string
}

export interface PaymentWithCollector extends Payment {
  collectors: { name: string } | null
}

export interface InvoiceReceipt {
  id: string
  period_month: string
  amount_due: number
  due_date: string | null
  postponed_to: string | null
  status: InvoiceStatus
  waive_reason: WaiveReason | null
  subscribers: { name: string; phone: string | null } | null
  services: { name: string; companies: { name: string } | null } | null
}

export interface ReceiptPayment {
  amount: number
  payment_date: string
  method: string
}
