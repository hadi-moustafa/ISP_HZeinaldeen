import { supabase } from '../supabase'
import type { Subscriber, SubscriberFilters, SubscriberWithRelations } from '../../types/subscribers'

const SUBSCRIBER_SELECT = `
  *,
  owners(name),
  default_collector:collectors!default_collector_id(name),
  services(name, sell_price, paid_price, companies(name)),
  addresses(name),
  company:companies!company_id(name)
`

export type SubscriberSearchField = 'name' | 'id' | 'owner' | 'username'

// Active subscribers whose expiry_date falls within [fromDate, toDate]
// inclusive -- used by the dashboard's expiry-watch feature, which buckets
// this into cumulative windows (today+tomorrow / today..+2 / today..+5),
// not exact-day snapshots.
export async function listSubscribersByExpiryRange(fromDate: string, toDate: string) {
  const { data, error } = await supabase
    .from('subscribers')
    .select(SUBSCRIBER_SELECT)
    .eq('connection_status', 'active')
    .gte('expiry_date', fromDate)
    .lte('expiry_date', toDate)
    .order('name')
  if (error) throw error
  return data as unknown as SubscriberWithRelations[]
}

// Active subscribers whose expiry_date is strictly before fromDate -- i.e.
// already expired and needing renewal. Used by the "Company payments due"
// dashboard table's "Have" column to compute what's already come due for
// each company, as opposed to what's still ahead.
export async function listSubscribersByExpiryBefore(fromDate: string) {
  const { data, error } = await supabase
    .from('subscribers')
    .select(SUBSCRIBER_SELECT)
    .eq('connection_status', 'active')
    .lt('expiry_date', fromDate)
    .order('name')
  if (error) throw error
  return data as unknown as SubscriberWithRelations[]
}

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
  searchField: SubscriberSearchField = 'name',
  ownerIdsForSearch: string[] | null = null,
) {
  let query = supabase.from('subscribers').select(SUBSCRIBER_SELECT)

  if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)
  if (filters.collectorId) query = query.eq('default_collector_id', filters.collectorId)
  if (filters.addressId) query = query.eq('address_id', filters.addressId)
  if (filters.serviceId) {
    query = query.eq('service_id', filters.serviceId)
  } else if (serviceIdsForCompany) {
    query = query.in('service_id', serviceIdsForCompany.length > 0 ? serviceIdsForCompany : [''])
  }
  if (filters.status) query = query.eq('connection_status', filters.status)
  if (filters.expiryFrom) query = query.gte('expiry_date', filters.expiryFrom)
  if (filters.expiryTo) query = query.lte('expiry_date', filters.expiryTo)
  if (filters.connectionFrom) query = query.gte('connection_date', filters.connectionFrom)
  if (filters.connectionTo) query = query.lte('connection_date', filters.connectionTo)
  if (filters.phone.trim()) query = query.ilike('phone', `%${filters.phone.trim().replace(/[%,]/g, '')}%`)
  if (filters.nationality) query = query.eq('nationality', filters.nationality)
  if (filters.notes.trim()) query = query.ilike('notes', `%${filters.notes.trim().replace(/[%,]/g, '')}%`)

  if (filters.search.trim() && searchField !== 'id') {
    // 'id' search is applied client-side after fetch -- PostgREST doesn't
    // support ilike against a uuid column even with a `column::text` cast
    // filter (confirmed against the live project: "operator does not exist:
    // uuid ~~* unknown").
    const term = filters.search.trim().replace(/[%,]/g, '')
    if (searchField === 'owner') {
      query = query.in('owner_id', ownerIdsForSearch && ownerIdsForSearch.length > 0 ? ownerIdsForSearch : [''])
    } else if (searchField === 'username') {
      query = query.ilike('external_username', `%${term}%`)
    } else {
      query = query.ilike('name', `%${term}%`)
    }
  }

  const { data, error } = await query.order('name')
  if (error) throw error
  return data as unknown as SubscriberWithRelations[]
}

// Subscribers missing at least one commonly-blank field from the Excel
// import (phone, address, nationality, building) -- surfaced so an
// admin can walk down the list and fill gaps in real data rather than
// hunting for them one profile at a time.
export async function listSubscribersWithMissingData() {
  const { data, error } = await supabase
    .from('subscribers')
    .select(SUBSCRIBER_SELECT)
    .or('phone.is.null,address_id.is.null,nationality.is.null,building.is.null')
    .order('name')
  if (error) throw error
  return data as unknown as SubscriberWithRelations[]
}

export interface DuplicateSubscriberGroup {
  matchType: 'username' | 'name'
  matchValue: string
  subscribers: SubscriberWithRelations[]
}

// Groups subscribers that share a normalized (trimmed/lowercased) username
// or name -- surfaced so an admin can spot likely duplicate entries (double
// import, same person re-added, a typo'd re-signup) rather than only
// finding them by accident. A subscriber pair matching on both username
// and name will show up in both a username group and a name group -- that
// duplication is intentional, it's a stronger signal, not a bug.
export async function listDuplicateSubscribers(): Promise<DuplicateSubscriberGroup[]> {
  const { data, error } = await supabase.from('subscribers').select(SUBSCRIBER_SELECT).order('name')
  if (error) throw error
  const subs = data as unknown as SubscriberWithRelations[]

  function groupBy(keyFn: (s: SubscriberWithRelations) => string | null): Map<string, SubscriberWithRelations[]> {
    const map = new Map<string, SubscriberWithRelations[]>()
    for (const s of subs) {
      const key = keyFn(s)
      if (!key) continue
      const list = map.get(key) ?? []
      list.push(s)
      map.set(key, list)
    }
    return map
  }

  const byUsername = groupBy((s) => (s.external_username ? s.external_username.trim().toLowerCase() : null))
  const byName = groupBy((s) => (s.name ? s.name.trim().toLowerCase() : null))

  const groups: DuplicateSubscriberGroup[] = []
  for (const [value, list] of byUsername) {
    if (list.length > 1) groups.push({ matchType: 'username', matchValue: value, subscribers: list })
  }
  for (const [value, list] of byName) {
    if (list.length > 1) groups.push({ matchType: 'name', matchValue: value, subscribers: list })
  }
  return groups
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

// Subscribers currently carrying debt. Reads the stored subscribers.debt
// column (kept live-synced by DB triggers -- see 0016_billing_engine.sql)
// rather than scanning invoices at read time; debt > 0 is the one source
// of truth for "in debt" everywhere in the app now (this list's Debt
// filter, the dashboard's debt count, card border color).
export async function listDebtSubscriberIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('subscribers').select('id').gt('debt', 0)
  if (error) throw error
  return new Set((data ?? []).map((row) => row.id as string))
}

export interface SubscriberInput {
  name: string
  external_username: string
  phone: string | null
  nationality: Subscriber['nationality']
  building: string | null
  address_id: string | null
  service_id: string | null
  company_id: string | null
  owner_id: string | null
  default_collector_id: string | null
  connection_status: Subscriber['connection_status']
  expiry_date: string | null
  connection_date: string | null
  notes: string | null
  password: string | null
  switch: string | null
  mac_address: string | null
  price: number | null
  balance: number | null
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

// Small-scope patch for filling in a subscriber field discovered missing
// mid-workflow (e.g. adding a phone number from the Pay modal) -- avoids
// forcing a caller to round-trip the full SubscriberInput just to set one
// or two fields.
export async function updateSubscriberFields(id: string, patch: Partial<SubscriberInput>) {
  const { data, error } = await supabase
    .from('subscribers')
    .update(patch)
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

// Bulk actions for the subscriber list's multiselect.
export async function bulkDeleteSubscribers(ids: string[]) {
  const { error } = await supabase.from('subscribers').delete().in('id', ids)
  if (error) throw error
}

export async function bulkSetConnectionStatus(ids: string[], status: Subscriber['connection_status']) {
  const { error } = await supabase.from('subscribers').update({ connection_status: status }).in('id', ids)
  if (error) throw error
}
