import { supabase } from '../supabase'
import type { ServiceWithCompany, ServiceWithStats } from '../../types/reference'

export async function listServices() {
  const { data, error } = await supabase
    .from('services')
    .select('*, companies(name)')
    .order('name')
  if (error) throw error
  return data as ServiceWithCompany[]
}

// Only used by the admin Services page -- every other call site just needs
// listServices() above. Subscriber count computed client-side, same
// pattern as listCompaniesWithSubscriberCount().
export async function listServicesWithSubscriberCount(): Promise<ServiceWithStats[]> {
  const [servicesRes, subscribersRes] = await Promise.all([
    supabase.from('services').select('*, companies(name)').order('name'),
    supabase.from('subscribers').select('service_id').not('service_id', 'is', null),
  ])
  if (servicesRes.error) throw servicesRes.error
  if (subscribersRes.error) throw subscribersRes.error

  const counts = new Map<string, number>()
  for (const row of subscribersRes.data as { service_id: string }[]) {
    counts.set(row.service_id, (counts.get(row.service_id) ?? 0) + 1)
  }

  return (servicesRes.data as ServiceWithCompany[]).map((s) => ({
    ...s,
    subscriber_count: counts.get(s.id) ?? 0,
  }))
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
