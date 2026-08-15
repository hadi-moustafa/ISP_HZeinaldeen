import { supabase } from '../supabase'
import type { Address } from '../../types/reference'

export async function listAddresses() {
  const { data, error } = await supabase.from('addresses').select('*').order('name')
  if (error) throw error
  return data as Address[]
}

export interface AddressInput {
  name: string
  is_active: boolean
}

export async function createAddress(input: AddressInput) {
  const { data, error } = await supabase.from('addresses').insert(input).select().single()
  if (error) throw error
  return data as Address
}

export async function updateAddress(id: string, input: AddressInput) {
  const { data, error } = await supabase
    .from('addresses')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Address
}

export async function deleteAddress(id: string) {
  const { error } = await supabase.from('addresses').delete().eq('id', id)
  if (error) throw error
}
