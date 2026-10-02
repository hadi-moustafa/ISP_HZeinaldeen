import { useNavigate, useLocation } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'
import { isCollector, isTechnician } from './permissions'
import type { CurrentStaff } from '../types/staff'

// Where "home" is for this staff member -- collectors never see the
// dashboard (ProtectedRoute bounces them to /subscribers), so their home is
// the subscriber list instead.
// Technicians only ever see their Tasks page.
export function homePath(staff: CurrentStaff | null): string {
  if (isTechnician(staff)) return '/tasks'
  return isCollector(staff) ? '/subscribers' : '/'
}

// Top-level pages, reached from the hamburger drawer. Returning from one of
// these goes to the dashboard (client instruction); anything else (a
// subscriber's detail/edit/new page) is a page you drilled into from
// somewhere, so returning goes back to wherever that was.
const ROOT_PATHS = [
  '/',
  '/subscribers',
  '/dabdabeh',
  '/tasks',
  '/reports/monthly-log',
  '/reports/financials',
  '/field',
]

export function isRootPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return ROOT_PATHS.includes(path) || path.startsWith('/admin/')
}

// Parent route to fall back to when a nested page was opened directly (a
// fresh tab or reload), so there's no in-app history entry to go back to.
function parentPath(pathname: string): string | null {
  const edit = pathname.match(/^\/subscribers\/([^/]+)\/edit\/?$/)
  if (edit) return `/subscribers/${edit[1]}`
  if (pathname.startsWith('/subscribers/')) return '/subscribers'
  return null
}

// The one "return" behavior used by the header's back arrow and by every
// page that finishes an action (save, cancel, delete): root page -> home,
// nested page -> the page you came from.
export function useGoBack() {
  const navigate = useNavigate()
  const location = useLocation()
  const { staff } = useStaff()

  return () => {
    const home = homePath(staff)
    if (isRootPath(location.pathname)) {
      navigate(home)
      return
    }
    // location.key is 'default' only for the very first entry the app
    // loaded on, i.e. there's no in-app page behind this one to go back to.
    if (location.key !== 'default') navigate(-1)
    else navigate(parentPath(location.pathname) ?? home, { replace: true })
  }
}
