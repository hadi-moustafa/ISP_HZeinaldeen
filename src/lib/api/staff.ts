import { supabase } from '../supabase'

// The collector's login credentials, kept on the separate `staff` table
// (not `collectors`) -- collectors.name/phone is the business entity used
// everywhere else in the app (subscriber forms, payment attribution,
// selects); this is only the account a collector actually signs in with.
export interface CollectorStaff {
  id: string
  username: string
  is_active: boolean
}

export async function getCollectorStaff(collectorId: string): Promise<CollectorStaff | null> {
  const { data, error } = await supabase
    .from('staff')
    .select('id, username, is_active')
    .eq('collector_id', collectorId)
    .eq('role', 'collector')
    .maybeSingle()
  if (error) throw error
  return data as CollectorStaff | null
}

export async function createCollectorLogin(collectorId: string, username: string, password: string) {
  const { data, error } = await supabase.rpc('create_collector_login', {
    p_collector_id: collectorId,
    p_username: username,
    p_password: password,
  })
  if (error) throw error
  return data as string
}

export async function updateCollectorLoginUsername(staffId: string, username: string) {
  const { error } = await supabase.from('staff').update({ username }).eq('id', staffId)
  if (error) throw error
}

export async function resetCollectorLoginPassword(staffId: string, password: string) {
  const { error } = await supabase.rpc('set_staff_password', {
    p_staff_id: staffId,
    p_new_password: password,
  })
  if (error) throw error
}

// Called alongside deleteCollector() -- a deleted collector's login
// shouldn't keep working just because the FK is ON DELETE SET NULL rather
// than cascade.
export async function deleteCollectorLogin(collectorId: string) {
  const { error } = await supabase.from('staff').delete().eq('collector_id', collectorId).eq('role', 'collector')
  if (error) throw error
}
