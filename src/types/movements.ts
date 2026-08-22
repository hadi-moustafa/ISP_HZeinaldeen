export type MovementType = 'restock' | 'sale' | 'adjustment' | 'return'
export type MovementPaymentStatus = 'paid' | 'unpaid' | 'partial'

export interface ProductMovement {
  id: string
  product_id: string
  movement_type: MovementType
  quantity: number
  unit_price: number | null
  lot_id: string | null
  total_amount: number | null
  subscriber_id: string | null
  staff_id: string | null
  note: string | null
  movement_date: string
  payment_status: MovementPaymentStatus
  amount_paid: number
  created_at: string
}

// The money total for a movement line -- prefers the total_amount override
// (cable/bundle sales) over unit_price * abs(quantity) (everything else),
// matching the same COALESCE every SQL/UI call site uses.
export function movementLineTotal(m: Pick<ProductMovement, 'total_amount' | 'unit_price' | 'quantity'>): number {
  return m.total_amount ?? (m.unit_price ?? 0) * Math.abs(m.quantity)
}

export interface ProductMovementWithSubscriber extends ProductMovement {
  subscribers: { name: string } | null
}
