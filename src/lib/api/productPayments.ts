import { supabase } from '../supabase'
import { updateMovementPaymentStatus } from './movements'
import type { ProductMovement } from '../../types/movements'

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

// Single entry point for logging ANY sale (standard/cable/bundle) --
// wraps log_product_sale() in 0026_product_lots_cable_bundles.sql, which
// picks the right FIFO lot (or, for a bundle, the right lot per
// component) and computes payment_status from amountPaid vs. the real
// charge. totalAmount is the override for "what this line actually
// charges" -- required for cable/bundle (the flat/custom price), optional
// for standard (a discount off the lot's own sell_price).
export async function logProductSale(input: {
  productId: string
  quantity: number
  subscriberId: string | null
  note: string | null
  staffId: string | null
  movementDate: string
  totalAmount: number | null
  amountPaid: number
}) {
  const { data, error } = await supabase.rpc('log_product_sale', {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_subscriber_id: input.subscriberId,
    p_note: input.note,
    p_staff_id: input.staffId,
    p_movement_date: input.movementDate,
    p_total_amount: input.totalAmount,
    p_amount_paid: input.amountPaid,
  })
  if (error) throw error
  return data as string
}

// Logs a brand-new product sale for this subscriber (picked via the Pay
// modal's + picker) at quantity 1, whatever price/discount was actually
// collected.
export async function recordProductSalePayment(input: {
  productId: string
  subscriberId: string
  staffId: string | null
  unitPrice: number
  amountPaid: number
  movementDate: string
  note: string | null
}) {
  await logProductSale({
    productId: input.productId,
    quantity: 1,
    subscriberId: input.subscriberId,
    note: input.note,
    staffId: input.staffId,
    movementDate: input.movementDate,
    totalAmount: input.unitPrice,
    amountPaid: input.amountPaid,
  })
}

// General-purpose product sale -- the Product Sale page's line-item
// version of recordProductSalePayment above: arbitrary quantity (not
// pinned to 1) and a nullable subscriberId so a sale can go to an
// existing subscriber OR a walk-in customer with no subscriber record at
// all (outsideCustomerName folded into the note in that case, since
// product_movements has no dedicated column for a non-subscriber buyer).
// totalAmount is required for cable/bundle lines (the flat/custom charge)
// and null for a plain standard-product line (unit_price * quantity).
export async function recordProductSale(input: {
  productId: string
  subscriberId: string | null
  outsideCustomerName: string | null
  staffId: string | null
  quantity: number
  totalAmount: number | null
  amountPaid: number
  movementDate: string
  note: string | null
}) {
  const note =
    [input.outsideCustomerName ? `Customer: ${input.outsideCustomerName}` : null, input.note].filter(Boolean).join(' · ') ||
    null
  await logProductSale({
    productId: input.productId,
    quantity: input.quantity,
    subscriberId: input.subscriberId,
    note,
    staffId: input.staffId,
    movementDate: input.movementDate,
    totalAmount: input.totalAmount,
    amountPaid: input.amountPaid,
  })
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
// 0022_pay_modal_engine.sql, updated by 0026 to honor total_amount).
// Returns the amount actually applied; an unapplied remainder means there
// was nothing left to credit.
export async function applyProductOverpaymentCredit(subscriberId: string, creditAmount: number) {
  const { data, error } = await supabase.rpc('apply_product_overpayment_fifo', {
    p_subscriber_id: subscriberId,
    p_credit_amount: creditAmount,
  })
  if (error) throw error
  return data as number
}
