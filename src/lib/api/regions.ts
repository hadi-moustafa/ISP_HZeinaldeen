import { supabase } from '../supabase'
import type { Region } from '../../types/reference'

export async function listRegions() {
  const { data, error } = await supabase.from('regions').select('*').order('name')
  if (error) throw error
  return data as Region[]
}

export interface RegionInput {
  name: string
  is_active: boolean
}

export async function createRegion(input: RegionInput) {
  const { data, error } = await supabase.from('regions').insert(input).select().single()
  if (error) throw error
  return data as Region
}

export async function updateRegion(id: string, input: RegionInput) {
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
