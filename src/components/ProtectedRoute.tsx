import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'
import { isAdmin, isCollector } from '../lib/permissions'

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

  // Collectors only get the Subscribers page and its functionality --
  // checked here, once, so it applies to every route (dashboard, admin,
  // reports, field) without each one needing its own guard.
  if (isCollector(staff) && !location.pathname.startsWith('/subscribers')) {
    return <Navigate to="/subscribers" replace />
  }

  return <>{children}</>
}
