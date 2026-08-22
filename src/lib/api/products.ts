import { supabase } from '../supabase'
import type { Product, ProductLot, ProductStockSummary, BundleItemWithProduct, ProductType } from '../../types/reference'

export async function listProducts() {
  const { data, error } = await supabase.from('products').select('*').order('name')
  if (error) throw error
  return data as Product[]
}

export interface ProductInput {
  sku: string | null
  name: string
  category: string | null
  cost_price: number
  sell_price: number
  reorder_level: number
  unit: string
  is_active: boolean
  product_type: ProductType
  cable_unit_length: number | null
}

export async function createProduct(input: ProductInput) {
  const { data, error } = await supabase.from('products').insert(input).select().single()
  if (error) throw error
  return data as Product
}

export async function updateProduct(id: string, input: ProductInput) {
  const { data, error } = await supabase
    .from('products')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Product
}

export async function deleteProduct(id: string) {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

// Every product plus its total stock across all lots and its active
// (oldest, in-stock) lot's own cost/sell price -- what "what will the next
// sale actually charge" needs, since products.cost_price/sell_price are
// now just the default for the NEXT new lot, not the live price. Built
// client-side from listProducts()+listAllOpenLots() rather than a DB view,
// since it's a small dataset (a reseller's product catalog) and avoids a
// migration round-trip for a read-only convenience shape.
export async function listProductStockSummary(): Promise<ProductStockSummary[]> {
  const [products, lots] = await Promise.all([listProducts(), listAllOpenLots()])
  const lotsByProduct = new Map<string, ProductLot[]>()
  for (const lot of lots) {
    if (lot.quantity_in_stock <= 0) continue
    const list = lotsByProduct.get(lot.product_id) ?? []
    list.push(lot)
    lotsByProduct.set(lot.product_id, list)
  }
  return products.map((p) => {
    const openLots = (lotsByProduct.get(p.id) ?? []).sort((a, b) => a.received_date.localeCompare(b.received_date))
    return {
      ...p,
      total_stock: openLots.reduce((sum, l) => sum + l.quantity_in_stock, 0),
      active_lot: openLots[0] ?? null,
      open_lot_count: openLots.length,
    }
  })
}

export async function listAllOpenLots() {
  const { data, error } = await supabase
    .from('product_lots')
    .select('*')
    .gt('quantity_in_stock', 0)
    .order('received_date')
  if (error) throw error
  return data as ProductLot[]
}

export async function listLotsForProduct(productId: string) {
  const { data, error } = await supabase
    .from('product_lots')
    .select('*')
    .eq('product_id', productId)
    .order('received_date', { ascending: false })
  if (error) throw error
  return data as ProductLot[]
}

export async function listBundleItems(bundleId: string) {
  const { data, error } = await supabase
    .from('bundle_items')
    .select('*, products(name, unit)')
    .eq('bundle_id', bundleId)
  if (error) throw error
  return data as unknown as BundleItemWithProduct[]
}

// Replaces the bundle's whole component list in one go -- simplest correct
// approach for a small admin-edited list (delete-then-reinsert rather than
// diffing), matching how few-row reference-data forms elsewhere in this
// app just resubmit their full set on save.
export async function saveBundleItems(bundleId: string, items: { productId: string; quantity: number }[]) {
  const { error: delError } = await supabase.from('bundle_items').delete().eq('bundle_id', bundleId)
  if (delError) throw delError
  if (items.length === 0) return
  const { error: insError } = await supabase
    .from('bundle_items')
    .insert(items.map((i) => ({ bundle_id: bundleId, product_id: i.productId, quantity: i.quantity })))
  if (insError) throw insError
}
