import { supabase } from '../supabase'
import type { Owner } from '../../types/reference'

export async function listOwners() {
  const { data, error } = await supabase.from('owners').select('*').order('name')
  if (error) throw error
  return data as Owner[]
}

export interface OwnerInput {
  name: string
  phone: string | null
}

export async function createOwner(input: OwnerInput) {
  const { data, error } = await supabase.from('owners').insert(input).select().single()
  if (error) throw error
  return data as Owner
}

export async function updateOwner(id: string, input: OwnerInput) {
  const { data, error } = await supabase.from('owners').update(input).eq('id', id).select().single()
  if (error) throw error
  return data as Owner
}

export async function deleteOwner(id: string) {
  const { error } = await supabase.from('owners').delete().eq('id', id)
  if (error) throw error
}
