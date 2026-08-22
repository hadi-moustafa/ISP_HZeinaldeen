export interface Company {
  id: string
  name: string
  notes: string | null
  payment_phone: string | null
  support_phone: string | null
  created_at: string
  updated_at: string
}

export interface CompanyWithStats extends Company {
  subscriber_count: number
}

export interface Service {
  id: string
  comp_id: string
  name: string
  sell_price: number
  paid_price: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ServiceWithCompany extends Service {
  companies: { name: string } | null
}

export interface ServiceWithStats extends ServiceWithCompany {
  subscriber_count: number
}

export interface Collector {
  id: string
  name: string
  phone: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Address {
  id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Owner {
  id: string
  name: string
  phone: string | null
  created_at: string
  updated_at: string
}

export type ProductType = 'standard' | 'cable' | 'bundle'

export interface Product {
  id: string
  sku: string | null
  name: string
  category: string | null
  cost_price: number
  sell_price: number
  quantity_in_stock: number
  reorder_level: number
  unit: string
  is_active: boolean
  product_type: ProductType
  cable_unit_length: number | null
  created_at: string
  updated_at: string
}

// One purchase batch of a product -- own cost/sell price and remaining
// quantity, consumed FIFO by sales (oldest lot with enough stock).
export interface ProductLot {
  id: string
  product_id: string
  cost_price: number
  sell_price: number
  quantity_in_stock: number
  received_date: string
  note: string | null
  created_at: string
}

// One real product (and how much of it) a bundle-type product deducts
// stock from when sold.
export interface BundleItem {
  id: string
  bundle_id: string
  product_id: string
  quantity: number
}

export interface BundleItemWithProduct extends BundleItem {
  products: { name: string; unit: string } | null
}

// listProductStockSummary()'s shape: a product plus its total stock across
// all lots and its active (oldest, in-stock) lot's own cost/sell price and
// lot count -- what "the next sale will actually charge" needs, since
// products.cost_price/sell_price are now just the default for the next
// new lot, not the live price.
export interface ProductStockSummary extends Product {
  total_stock: number
  active_lot: ProductLot | null
  open_lot_count: number
}
