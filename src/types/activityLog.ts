export interface ActivityLogEntry {
  id: string
  staff_id: string | null
  summary: string
  entity_type: string | null
  entity_id: string | null
  created_at: string
}

export interface ActivityLogEntryWithStaff extends ActivityLogEntry {
  staff: { username: string } | null
}
