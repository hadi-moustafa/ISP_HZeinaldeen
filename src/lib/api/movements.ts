import { supabase } from '../supabase'
import type { MovementPaymentStatus, ProductMovementWithSubscriber } from '../../types/movements'

export async function listMovementsForProduct(productId: string) {
  const { data, error } = await supabase
    .from('product_movements')
    .select('*, subscribers(name)')
    .eq('product_id', productId)
    .order('movement_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as unknown as ProductMovementWithSubscriber[]
}

export interface MovementInput {
  product_id: string
  movement_type: 'restock' | 'sale' | 'adjustment' | 'return'
  quantity: number
  unit_price: number | null
  lot_id?: string | null
  subscriber_id: string | null
  staff_id: string | null
  note: string | null
  movement_date: string
  payment_status: MovementPaymentStatus
}

export async function createMovement(input: MovementInput) {
  const { data, error } = await supabase.from('product_movements').insert(input).select().single()
  if (error) throw error
  return data as unknown as ProductMovementWithSubscriber
}

export async function updateMovementPaymentStatus(id: string, paymentStatus: MovementPaymentStatus) {
  const { error } = await supabase
    .from('product_movements')
    .update({ payment_status: paymentStatus })
    .eq('id', id)
  if (error) throw error
}

// Records a new purchase batch (a new product_lots row + its matching
// restock movement, atomically) via restock_product_lot() in
// 0026_product_lots_cable_bundles.sql -- this is how "add new stock under
// the same product at a different cost/sell price" actually happens.
export async function restockProductLot(input: {
  productId: string
  quantity: number
  costPrice: number
  sellPrice: number
  note: string | null
  receivedDate: string
  staffId: string | null
}) {
  const { data, error } = await supabase.rpc('restock_product_lot', {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_cost_price: input.costPrice,
    p_sell_price: input.sellPrice,
    p_note: input.note,
    p_received_date: input.receivedDate,
    p_staff_id: input.staffId,
  })
  if (error) throw error
  return data as string
}
