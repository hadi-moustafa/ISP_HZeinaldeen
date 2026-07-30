import { NavLink, Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'

const tabs = [
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/services', label: 'Services' },
  { to: '/admin/collectors', label: 'Collectors' },
  { to: '/admin/owners', label: 'Owners' },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/import', label: 'Import' },
  { to: '/admin/company-payments', label: 'Company Payments' },
  { to: '/admin/activity-log', label: 'Activity Log' },
]

export function AdminLayout() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader>
        <nav className="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-2">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-neutral-500'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <main className="p-4">
          <Outlet />
        </main>
      </AppHeader>
    </div>
  )
}
