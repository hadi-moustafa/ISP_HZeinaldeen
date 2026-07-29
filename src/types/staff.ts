export type StaffRole = 'admin' | 'collector'

export interface CurrentStaff {
  id: string
  username: string
  role: StaffRole
  collectorId: string | null
}
