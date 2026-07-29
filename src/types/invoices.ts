export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'postponed' | 'waived'

export interface Invoice {
  id: string
  subscriber_id: string
  service_id: string | null
  period_month: string
  amount_due: number
  due_date: string | null
  postponed_to: string | null
  status: InvoiceStatus
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
  subscribers: { name: string; phone: string | null } | null
  services: { name: string; companies: { name: string } | null } | null
}

export interface ReceiptPayment {
  amount: number
  payment_date: string
  method: string
}
