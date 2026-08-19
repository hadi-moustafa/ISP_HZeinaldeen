import { supabase } from '../supabase'
import { createMovement, updateMovementPaymentStatus } from './movements'
import type { MovementPaymentStatus, ProductMovement } from '../../types/movements'

export interface OpenProductMovement extends ProductMovement {
  products: { name: string; sell_price: number } | null
}

// This subscriber's still-outstanding product sales -- the Pay modal's
// Products row shows these individually and sums them into its default
// amount. Distinct from listMovementsForProduct in movements.ts (scoped
// to one product's full history, used by the inventory page).
export async function listOpenSaleMovementsForSubscriber(subscriberId: string) {
  const { data, error } = await supabase
    .from('product_movements')
    .select('*, products(name, sell_price)')
    .eq('subscriber_id', subscriberId)
    .eq('movement_type', 'sale')
    .in('payment_status', ['unpaid', 'partial'])
    .order('movement_date', { ascending: true })
  if (error) throw error
  return data as unknown as OpenProductMovement[]
}

// Logs a brand-new product sale for this subscriber (picked via the
// modal's + picker), with whatever price/discount was actually collected.
// payment_status/amount_paid reflect what was actually paid at log time --
// under/over-payment handling (msama7, next-sale credit) is applied
// separately by the caller against this and other open movements.
export async function recordProductSalePayment(input: {
  productId: string
  subscriberId: string
  staffId: string | null
  unitPrice: number
  amountPaid: number
  movementDate: string
  note: string | null
}) {
  const paymentStatus: MovementPaymentStatus =
    input.amountPaid <= 0 ? 'unpaid' : input.amountPaid >= input.unitPrice ? 'paid' : 'partial'
  const movement = await createMovement({
    product_id: input.productId,
    movement_type: 'sale',
    quantity: -1,
    unit_price: input.unitPrice,
    subscriber_id: input.subscriberId,
    staff_id: input.staffId,
    note: input.note,
    movement_date: input.movementDate,
    payment_status: paymentStatus,
  })
  const { error } = await supabase
    .from('product_movements')
    .update({ amount_paid: Math.min(input.amountPaid, input.unitPrice) })
    .eq('id', movement.id)
  if (error) throw error
}

// General-purpose product sale -- the Product Sale page's line-item
// version of recordProductSalePayment above: arbitrary quantity (not
// pinned to 1) and a nullable subscriberId so a sale can go to an
// existing subscriber OR a walk-in customer with no subscriber record at
// all (outsideCustomerName folded into the note in that case, since
// product_movements has no dedicated column for a non-subscriber buyer).
export async function recordProductSale(input: {
  productId: string
  subscriberId: string | null
  outsideCustomerName: string | null
  staffId: string | null
  quantity: number
  unitPrice: number
  amountPaid: number
  movementDate: string
  note: string | null
}) {
  const total = input.unitPrice * input.quantity
  const paymentStatus: MovementPaymentStatus =
    input.amountPaid <= 0 ? 'unpaid' : input.amountPaid >= total ? 'paid' : 'partial'
  const note =
    [input.outsideCustomerName ? `Customer: ${input.outsideCustomerName}` : null, input.note].filter(Boolean).join(' · ') ||
    null
  const movement = await createMovement({
    product_id: input.productId,
    movement_type: 'sale',
    quantity: -input.quantity,
    unit_price: input.unitPrice,
    subscriber_id: input.subscriberId,
    staff_id: input.staffId,
    note,
    movement_date: input.movementDate,
    payment_status: paymentStatus,
  })
  const { error } = await supabase
    .from('product_movements')
    .update({ amount_paid: Math.min(input.amountPaid, total) })
    .eq('id', movement.id)
  if (error) throw error
}

// "Msama7" for a product sale -- forgive the remaining balance, mark it
// paid without a matching amount_paid. Thin wrapper naming the intent at
// this call site distinctly from the inventory page's own inline
// paid/unpaid/partial dropdown, which calls the same underlying update.
export async function waiveProductMovement(id: string) {
  await updateMovementPaymentStatus(id, 'paid')
}

// Overpayment on a product has no "next month's bill" to credit like a
// service does -- instead it's applied FIFO against this subscriber's
// other outstanding product sales (apply_product_overpayment_fifo in
// 0022_pay_modal_engine.sql). Returns the amount actually applied; an
// unapplied remainder means there was nothing left to credit.
export async function applyProductOverpaymentCredit(subscriberId: string, creditAmount: number) {
  const { data, error } = await supabase.rpc('apply_product_overpayment_fifo', {
    p_subscriber_id: subscriberId,
    p_credit_amount: creditAmount,
  })
  if (error) throw error
  return data as number
}
