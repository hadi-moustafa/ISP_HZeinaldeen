export type MovementType = 'restock' | 'sale' | 'adjustment' | 'return'
export type MovementPaymentStatus = 'paid' | 'unpaid' | 'partial'

export interface ProductMovement {
  id: string
  product_id: string
  movement_type: MovementType
  quantity: number
  unit_price: number | null
  subscriber_id: string | null
  staff_id: string | null
  note: string | null
  movement_date: string
  payment_status: MovementPaymentStatus
  amount_paid: number
  created_at: string
}

export interface ProductMovementWithSubscriber extends ProductMovement {
  subscribers: { name: string } | null
}
