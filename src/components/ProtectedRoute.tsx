import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'
import { isAdmin, isCollector, isTechnician } from '../lib/permissions'

export function ProtectedRoute({
  children,
  adminOnly = false,
  technicianOnly = false,
}: {
  children: ReactNode
  adminOnly?: boolean
  technicianOnly?: boolean
}) {
  const { staff, loading } = useStaff()
  const location = useLocation()

  if (loading) return null

  if (!staff) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  // Technicians get exactly one page, their Tasks list.
  if (isTechnician(staff)) {
    return technicianOnly ? <>{children}</> : <Navigate to="/tasks" replace />
  }
  if (technicianOnly) {
    return <Navigate to={isAdmin(staff) ? '/admin/tasks' : '/'} replace />
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
