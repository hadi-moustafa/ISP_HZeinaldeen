export type MovementType = 'restock' | 'sale' | 'adjustment' | 'return'

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
  created_at: string
}

export interface ProductMovementWithSubscriber extends ProductMovement {
  subscribers: { name: string } | null
}
