export interface Company {
  id: string
  name: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CompanyAddress {
  id: string
  comp_id: string
  label: string | null
  line1: string | null
  line2: string | null
  city: string | null
  region: string | null
  country: string | null
  is_primary: boolean
  created_at: string
  updated_at: string
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

export interface Collector {
  id: string
  name: string
  phone: string | null
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
  created_at: string
  updated_at: string
}
