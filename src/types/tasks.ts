export type TaskStatus = 'open' | 'in_progress' | 'half_done' | 'done' | 'cant_do'
export type TaskPriority = 'normal' | 'high' | 'urgent'
export type TaskOrderStatus = 'requested' | 'sold' | 'rejected'

export interface TaskProductOrder {
  id: string
  task_id: string
  product_id: string
  quantity: number
  note: string | null
  status: TaskOrderStatus
  movement_id: string | null
  handled_at: string | null
  created_at: string
  products: { name: string; product_type: 'standard' | 'cable' | 'bundle'; sell_price: number } | null
  requested_by_staff: { username: string } | null
}

export interface Task {
  id: string
  subscriber_id: string | null
  subscriber_name: string
  address: string | null
  phone: string | null
  // Map link for where the job is (e.g. a Google Maps share link).
  location_url: string | null
  problem: string
  possible_fixes: string | null
  notes: string | null
  priority: TaskPriority
  assigned_to: string | null
  status: TaskStatus
  report: string | null
  created_by: string | null
  created_at: string
  status_changed_at: string | null
  finished_at: string | null
  updated_at: string
}

export interface TaskWithRelations extends Task {
  assigned_staff: { username: string } | null
  status_changed_staff: { username: string } | null
  task_product_orders: TaskProductOrder[]
}

export interface TaskInput {
  subscriber_id: string | null
  subscriber_name: string
  address: string | null
  phone: string | null
  location_url: string | null
  problem: string
  possible_fixes: string | null
  notes: string | null
  priority: TaskPriority
  assigned_to: string | null
}
