import { useStaff } from '../context/StaffContext'

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

      <p className="mt-8 text-center text-neutral-500 dark:text-neutral-400">
        Reference data, subscribers, and reporting land in the next phases.
      </p>
    </div>
  )
}
