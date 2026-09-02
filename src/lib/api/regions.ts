import { supabase } from '../supabase'
import type { Region } from '../../types/reference'

// Regions are scoped under an address (see 0027_regions_under_address.sql)
// -- pass addressId to get just that address's regions (the subscriber
// form/list's cascading second-tier picker), or omit it to get every
// region across every address (the admin management screen).
export async function listRegions(addressId?: string) {
  let query = supabase.from('regions').select('*').order('name')
  if (addressId) query = query.eq('address_id', addressId)
  const { data, error } = await query
  if (error) throw error
  return data as Region[]
}

export interface RegionInput {
  address_id: string
  name: string
  is_active: boolean
}

export async function createRegion(input: RegionInput) {
  const { data, error } = await supabase.from('regions').insert(input).select().single()
  if (error) throw error
  return data as Region
}

export async function updateRegion(id: string, input: Partial<RegionInput>) {
  const { data, error } = await supabase
    .from('regions')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Region
}

export async function deleteRegion(id: string) {
  const { error } = await supabase.from('regions').delete().eq('id', id)
  if (error) throw error
}
