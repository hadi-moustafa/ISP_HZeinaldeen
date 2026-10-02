export type StaffRole = 'admin' | 'collector' | 'technician'

export interface CurrentStaff {
  id: string
  username: string
  role: StaffRole
  collectorId: string | null
}
