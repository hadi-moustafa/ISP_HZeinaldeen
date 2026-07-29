import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStaff } from '../context/StaffContext'
import { isAdmin } from '../lib/permissions'
import { generateMonthlyInvoices } from '../lib/api/invoices'
import { primaryButtonClass } from '../lib/uiClasses'

const links = [
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/services', label: 'Services' },
  { to: '/admin/collectors', label: 'Collectors' },
  { to: '/admin/owners', label: 'Owners' },
  { to: '/admin/products', label: 'Products' },
]

export function DashboardPage() {
  const { staff, logout } = useStaff()
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)

  async function handleGenerateInvoices() {
    setGenerating(true)
    setGenerateResult(null)
    try {
      const result = await generateMonthlyInvoices()
      setGenerateResult(`Created ${result.created}, skipped ${result.skipped}.`)
    } catch (err) {
      setGenerateResult(err instanceof Error ? err.message : 'Failed to generate invoices')
    } finally {
      setGenerating(false)
    }
  }

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

      <div className="mt-8 grid grid-cols-2 gap-3">
        <Link
          to="/subscribers"
          className="block rounded-lg border border-blue-200 bg-blue-50 p-4 text-center font-medium text-blue-700 shadow-sm dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
        >
          Subscribers
        </Link>
        <Link
          to="/reports/monthly-log"
          className="block rounded-lg border border-blue-200 bg-blue-50 p-4 text-center font-medium text-blue-700 shadow-sm dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
        >
          Monthly Log
        </Link>
      </div>

      {isAdmin(staff) && (
        <Link
          to="/reports/financials"
          className="mt-3 block rounded-lg border border-purple-200 bg-purple-50 p-4 text-center font-medium text-purple-700 shadow-sm dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300"
        >
          Financial Report
        </Link>
      )}

      {isAdmin(staff) && (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
            Invoices generate automatically on the 1st of each month. Use this to backfill or
            re-run for the current month.
          </p>
          <button
            onClick={handleGenerateInvoices}
            disabled={generating}
            className={primaryButtonClass}
          >
            {generating ? 'Generating…' : "Generate this month's invoices"}
          </button>
          {generateResult && (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              {generateResult}
            </p>
          )}
        </div>
      )}

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
