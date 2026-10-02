import { supabase } from '../supabase'
import type { SubscriberWithRelations } from '../../types/subscribers'

export interface ManagementEntry {
  id: string
  subscriber_id: string
  notes: string | null
  fee: number | null
  added_at: string
  done_at: string | null
  added_by_staff: { username: string } | null
  done_by_staff: { username: string } | null
  subscriber: SubscriberWithRelations
}

// Same subscriber embed as Dabdabeh's collect track (mirrors
// SUBSCRIBER_SELECT in lib/api/subscribers.ts).
const MANAGEMENT_SELECT = `
  id, subscriber_id, notes, fee, added_at, done_at,
  added_by_staff:staff!added_by(username),
  done_by_staff:staff!done_by(username),
  subscriber:subscribers (
    *,
    owners(name),
    default_collector:collectors!default_collector_id(name),
    services(name, sell_price, paid_price, companies(name)),
    addresses(name),
    company:companies!company_id(name)
  )
`

export async function listOpenManagement(): Promise<ManagementEntry[]> {
  const { data, error } = await supabase
    .from('management_items')
    .select(MANAGEMENT_SELECT)
    .is('done_at', null)
    .order('added_at')
  if (error) throw error
  return data as unknown as ManagementEntry[]
}

export async function listDoneManagement(limit = 50): Promise<ManagementEntry[]> {
  const { data, error } = await supabase
    .from('management_items')
    .select(MANAGEMENT_SELECT)
    .not('done_at', 'is', null)
    .order('done_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as unknown as ManagementEntry[]
}

// Adds subscribers to the shared open list. Anyone already on it is
// skipped (the partial unique index on subscriber_id WHERE done_at IS NULL
// can't be targeted by an upsert, so they're filtered out first). Returns
// the ids that were actually added, so only those get logged.
export async function addToManagement(staffId: string, subscriberIds: string[]): Promise<string[]> {
  const { data: open, error: openError } = await supabase
    .from('management_items')
    .select('subscriber_id')
    .is('done_at', null)
    .in('subscriber_id', subscriberIds)
  if (openError) throw openError
  const already = new Set((open ?? []).map((r) => r.subscriber_id as string))
  const toAdd = subscriberIds.filter((id) => !already.has(id))
  if (toAdd.length === 0) return []
  const { error } = await supabase
    .from('management_items')
    .insert(toAdd.map((subscriberId) => ({ subscriber_id: subscriberId, added_by: staffId })))
  if (error) throw error
  return toAdd
}

export async function updateManagementEntry(id: string, values: { notes: string | null; fee: number | null }) {
  const { error } = await supabase.from('management_items').update(values).eq('id', id)
  if (error) throw error
}

// Finishes an entry: saves the final notes/fee and stamps done_at/done_by
// in one update. The row stays as history.
export async function finishManagementEntry(
  id: string,
  staffId: string,
  values: { notes: string | null; fee: number | null },
): Promise<string> {
  const doneAt = new Date().toISOString()
  const { error } = await supabase
    .from('management_items')
    .update({ ...values, done_at: doneAt, done_by: staffId })
    .eq('id', id)
  if (error) throw error
  return doneAt
}

export async function removeManagementEntry(id: string) {
  const { error } = await supabase.from('management_items').delete().eq('id', id)
  if (error) throw error
}

// Date + time in Beirut (the DB clock is UTC), for the page and for the
// activity log text, so each log line says exactly when it happened.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Beirut',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
