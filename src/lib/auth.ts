import { supabase } from './supabase'
import type { CurrentStaff } from '../types/staff'

export async function loginStaff(
  username: string,
  password: string,
): Promise<{ staff: CurrentStaff | null; error: string | null }> {
  const { data, error } = await supabase.rpc('login_staff', {
    p_username: username,
    p_password: password,
  })

  if (error) {
    return { staff: null, error: error.message }
  }

  const row = data?.[0]
  if (!row) {
    return { staff: null, error: 'Invalid username or password' }
  }

  return {
    staff: {
      id: row.id,
      username: row.username,
      role: row.role,
      collectorId: row.collector_id,
    },
    error: null,
  }
}
