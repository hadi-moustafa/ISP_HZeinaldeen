import { supabase } from '../supabase'
import type { ActivityLogEntryWithStaff } from '../../types/activityLog'

// Fire-and-forget: a logging failure should never break the operation it's
// describing. Called from page-level success handlers (not from lib/api
// mutators themselves) since staff identity lives in StaffContext, not in
// the DB session -- this app uses a custom `staff` table, not Supabase Auth.
export function logActivity(
  staffId: string | null,
  summary: string,
  entityType?: string,
  entityId?: string,
) {
  supabase
    .from('activity_log')
    .insert({
      staff_id: staffId,
      summary,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
    })
    .then(({ error }) => {
      if (error) console.error('Failed to record activity log entry:', error.message)
    })
}

export async function listActivityLog(limit = 100) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*, staff(username)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as unknown as ActivityLogEntryWithStaff[]
}
