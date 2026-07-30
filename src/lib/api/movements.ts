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
