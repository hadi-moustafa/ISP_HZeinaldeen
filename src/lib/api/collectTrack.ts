import { supabase } from '../supabase'
import type { SubscriberWithRelations } from '../../types/subscribers'

export interface CollectTrackEntry {
  id: string
  position: number
  subscriber: SubscriberWithRelations
}

// Mirrors SUBSCRIBER_SELECT in lib/api/subscribers.ts (not exported from
// there) so Dabdabeh rows carry the same joined relations as everywhere
// else a SubscriberWithRelations is used (PaymentModal, the pencil-edit
// link, etc.).
const TRACKED_SUBSCRIBER_SELECT = `
  id, position, subscriber_id,
  subscribers (
    *,
    owners(name),
    default_collector:collectors!default_collector_id(name),
    services(name, sell_price, paid_price, companies(name)),
    addresses(name),
    company:companies!company_id(name)
  )
`

export async function listCollectTrack(staffId: string): Promise<CollectTrackEntry[]> {
  const { data, error } = await supabase
    .from('collect_track_items')
    .select(TRACKED_SUBSCRIBER_SELECT)
    .eq('staff_id', staffId)
    .order('position')
  if (error) throw error
  return (data as unknown as { id: string; position: number; subscribers: SubscriberWithRelations }[]).map(
    (row) => ({ id: row.id, position: row.position, subscriber: row.subscribers }),
  )
}

// Skips subscribers already on this staff member's list (ON CONFLICT DO
// NOTHING) so re-selecting an already-tracked subscriber in a bulk action
// is a safe no-op, same idempotent-upsert style used elsewhere in this app.
export async function addToCollectTrack(staffId: string, subscriberIds: string[]): Promise<void> {
  const { data: existing, error: maxError } = await supabase
    .from('collect_track_items')
    .select('position')
    .eq('staff_id', staffId)
    .order('position', { ascending: false })
    .limit(1)
  if (maxError) throw maxError
  let nextPosition = (existing?.[0]?.position ?? -1) + 1

  const rows = subscriberIds.map((subscriberId) => ({
    staff_id: staffId,
    subscriber_id: subscriberId,
    position: nextPosition++,
  }))
  const { error } = await supabase
    .from('collect_track_items')
    .upsert(rows, { onConflict: 'staff_id,subscriber_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function removeFromCollectTrack(staffId: string, subscriberId: string): Promise<void> {
  const { error } = await supabase
    .from('collect_track_items')
    .delete()
    .eq('staff_id', staffId)
    .eq('subscriber_id', subscriberId)
  if (error) throw error
}

// Bulk-updates position to match the given order (index in the array =
// new position) -- called once per drag-and-drop reorder on the Dabdabeh
// page.
export async function reorderCollectTrack(staffId: string, orderedEntryIds: string[]): Promise<void> {
  await Promise.all(
    orderedEntryIds.map((id, index) =>
      supabase.from('collect_track_items').update({ position: index }).eq('id', id).eq('staff_id', staffId),
    ),
  )
}
