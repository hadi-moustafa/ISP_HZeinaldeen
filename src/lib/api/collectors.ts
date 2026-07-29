import { supabase } from '../supabase'
import type { Collector } from '../../types/reference'

export async function listCollectors() {
  const { data, error } = await supabase.from('collectors').select('*').order('name')
  if (error) throw error
  return data as Collector[]
}

export interface CollectorInput {
  name: string
  phone: string | null
  is_active: boolean
}

export async function createCollector(input: CollectorInput) {
  const { data, error } = await supabase.from('collectors').insert(input).select().single()
  if (error) throw error
  return data as Collector
}

export async function updateCollector(id: string, input: CollectorInput) {
  const { data, error } = await supabase
    .from('collectors')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Collector
}

export async function deleteCollector(id: string) {
  const { error } = await supabase.from('collectors').delete().eq('id', id)
  if (error) throw error
}
