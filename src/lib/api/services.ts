import { supabase } from '../supabase'
import type { ServiceWithCompany } from '../../types/reference'

export async function listServices() {
  const { data, error } = await supabase
    .from('services')
    .select('*, companies(name)')
    .order('name')
  if (error) throw error
  return data as ServiceWithCompany[]
}

export interface ServiceInput {
  comp_id: string
  name: string
  sell_price: number
  paid_price: number
  is_active: boolean
}

export async function createService(input: ServiceInput) {
  const { data, error } = await supabase.from('services').insert(input).select().single()
  if (error) throw error
  return data
}

export async function updateService(id: string, input: ServiceInput) {
  const { data, error } = await supabase.from('services').update(input).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteService(id: string) {
  const { error } = await supabase.from('services').delete().eq('id', id)
  if (error) throw error
}
