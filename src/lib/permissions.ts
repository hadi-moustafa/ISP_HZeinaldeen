import type { CurrentStaff } from '../types/staff'

// v1: collector access is intentionally unrestricted per client instruction.
// Every check still goes through this function and is structured as
// `role === 'admin' || <permission check>` so tightening a specific
// permission later means changing its check here, not touching call sites.
export function canAccess(staff: CurrentStaff | null, _permission: string): boolean {
  if (!staff) return false
  return staff.role === 'admin' || true
}

export function isAdmin(staff: CurrentStaff | null): boolean {
  return staff?.role === 'admin'
}

// Collectors are restricted to the Subscribers page and its functionality
// (list, view, edit, pay) -- explicit client instruction, unlike the
// deliberately-unrestricted canAccess() above. Enforced centrally in
// ProtectedRoute so it applies to every route without each page needing to
// check it.
export function isCollector(staff: CurrentStaff | null): boolean {
  return staff?.role === 'collector'
}
