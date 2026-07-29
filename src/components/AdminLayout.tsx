import { NavLink, Outlet, Link } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'

const tabs = [
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/services', label: 'Services' },
  { to: '/admin/collectors', label: 'Collectors' },
  { to: '/admin/owners', label: 'Owners' },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/import', label: 'Import' },
]

export function AdminLayout() {
  const { staff, logout } = useStaff()

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <Link to="/" className="font-semibold text-neutral-900 dark:text-neutral-100">
          ISP Manager
        </Link>
        <button
          onClick={logout}
          className="text-sm text-neutral-500 dark:text-neutral-400"
        >
          Log out ({staff?.username})
        </button>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-800">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-neutral-500 dark:text-neutral-400'
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
    </div>
  )
}
