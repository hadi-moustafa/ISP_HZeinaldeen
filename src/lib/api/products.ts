import { supabase } from '../supabase'
import type { Product } from '../../types/reference'

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
