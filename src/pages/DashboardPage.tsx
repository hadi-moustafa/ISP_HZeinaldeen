import { Link } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'

const links = [
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/services', label: 'Services' },
  { to: '/admin/collectors', label: 'Collectors' },
  { to: '/admin/owners', label: 'Owners' },
  { to: '/admin/products', label: 'Products' },
]

export function DashboardPage() {
  const { staff, logout } = useStaff()

  return (
    <div className="min-h-screen bg-neutral-50 p-4 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Signed in as</p>
          <p className="font-medium text-neutral-900 dark:text-neutral-100">
            {staff?.username} ({staff?.role})
          </p>
        </div>
        <button
          onClick={logout}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-600 dark:text-neutral-100"
        >
          Log out
        </button>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
        Reference data
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="rounded-lg border border-neutral-200 bg-white p-4 text-center font-medium text-neutral-900 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
