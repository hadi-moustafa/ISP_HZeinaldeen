import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'
import { isAdmin } from '../lib/permissions'

export function ProtectedRoute({
  children,
  adminOnly = false,
}: {
  children: ReactNode
  adminOnly?: boolean
}) {
  const { staff, loading } = useStaff()
  const location = useLocation()

  if (loading) return null

  if (!staff) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (adminOnly && !isAdmin(staff)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
