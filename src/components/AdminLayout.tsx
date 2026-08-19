import { Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'

// The old always-visible horizontal tab strip listed every admin route
// flat, one per old page -- redundant now that related pages (Company,
// Products, Subscriber tools) are consolidated with their own in-page
// tabs, and the hamburger nav drawer already covers switching between
// these top-level sections. Just the header + page content now.
export function AdminLayout() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader>
        <main className="p-4">
          <Outlet />
        </main>
      </AppHeader>
    </div>
  )
}
