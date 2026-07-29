import { Link, Outlet } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'

export function ReportsLayout() {
  const { staff, logout } = useStaff()

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <Link to="/" className="font-semibold text-neutral-900 dark:text-neutral-100">
          ISP Manager
        </Link>
        <button onClick={logout} className="text-sm text-neutral-500 dark:text-neutral-400">
          Log out ({staff?.username})
        </button>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  )
}
