import { supabase } from '../supabase'
import type {
  Subscriber,
  SubscriberAddress,
  SubscriberFilters,
  SubscriberWithRelations,
} from '../../types/subscribers'

const SUBSCRIBER_SELECT = `
  *,
  owners(name),
  default_collector:collectors!default_collector_id(name),
  services(name, sell_price, companies(name))
`

export async function listSubscribersLite() {
  const { data, error } = await supabase
    .from('subscribers')
    .select('id, name')
    .order('name')
  if (error) throw error
  return data as { id: string; name: string }[]
}

export async function listSubscribers(
  filters: SubscriberFilters,
  serviceIdsForCompany: string[] | null,
) {
  let query = supabase.from('subscribers').select(SUBSCRIBER_SELECT)

  if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)
  if (filters.collectorId) query = query.eq('default_collector_id', filters.collectorId)
  if (filters.serviceId) {
    query = query.eq('service_id', filters.serviceId)
  } else if (serviceIdsForCompany) {
    query = query.in('service_id', serviceIdsForCompany.length > 0 ? serviceIdsForCompany : [''])
  }
  if (filters.status) query = query.eq('connection_status', filters.status)
  if (filters.expiryFrom) query = query.gte('expiry_date', filters.expiryFrom)
  if (filters.expiryTo) query = query.lte('expiry_date', filters.expiryTo)
  if (filters.search.trim()) {
    const term = filters.search.trim().replace(/[%,]/g, '')
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
  }

  const { data, error } = await query.order('name')
  if (error) throw error
  return data as unknown as SubscriberWithRelations[]
}

export async function getSubscriber(id: string) {
  const { data, error } = await supabase
    .from('subscribers')
    .select(SUBSCRIBER_SELECT)
    .eq('id', id)
    .single()
  if (error) throw error
  return data as unknown as SubscriberWithRelations
}

// Subscribers currently carrying debt (any unpaid/partial invoice). Fetched
// separately and applied client-side rather than as a PostgREST embedded
// filter, since "paid up" (no matching invoice at all) doesn't map cleanly
// onto embedded-resource filtering.
export async function listDebtSubscriberIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('invoices')
    .select('subscriber_id')
    .in('status', ['unpaid', 'partial'])
  if (error) throw error
  return new Set((data ?? []).map((row) => row.subscriber_id as string))
}

export interface SubscriberInput {
  name: string
  phone: string | null
  national_id: string | null
  service_id: string | null
  owner_id: string | null
  default_collector_id: string | null
  connection_status: Subscriber['connection_status']
  expiry_date: string | null
  connection_date: string | null
  notes: string | null
}

export async function createSubscriber(input: SubscriberInput) {
  const { data, error } = await supabase.from('subscribers').insert(input).select().single()
  if (error) throw error
  return data as Subscriber
}

export async function updateSubscriber(id: string, input: SubscriberInput) {
  const { data, error } = await supabase
    .from('subscribers')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Subscriber
}

export async function deleteSubscriber(id: string) {
  const { error } = await supabase.from('subscribers').delete().eq('id', id)
  if (error) throw error
}

export async function listSubscriberAddresses(subscriberId: string) {
  const { data, error } = await supabase
    .from('subscriber_addresses')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .order('is_primary', { ascending: false })
  if (error) throw error
  return data as SubscriberAddress[]
}

type AddressInput = {
  label: string | null
  line1: string | null
  line2: string | null
  city: string | null
  region: string | null
  country: string | null
  is_primary: boolean
}

export async function createSubscriberAddress(subscriberId: string, input: AddressInput) {
  const { data, error } = await supabase
    .from('subscriber_addresses')
    .insert({ ...input, subscriber_id: subscriberId })
    .select()
    .single()
  if (error) throw error
  return data as SubscriberAddress
}

export async function updateSubscriberAddress(id: string, input: AddressInput) {
  const { data, error } = await supabase
    .from('subscriber_addresses')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as SubscriberAddress
}

export async function deleteSubscriberAddress(id: string) {
  const { error } = await supabase.from('subscriber_addresses').delete().eq('id', id)
  if (error) throw error
}
