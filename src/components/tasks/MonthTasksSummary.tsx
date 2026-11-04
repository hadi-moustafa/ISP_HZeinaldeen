import { useEffect, useState } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'
import { listSubscriberTasksThisMonth } from '../../lib/api/tasks'
import { formatDateTime, orderLabel, STATUS_CLASS, STATUS_LABEL } from '../../lib/tasks'
import type { TaskWithRelations } from '../../types/tasks'

// Shown at the top of the Pay modal: technician work on this subscriber
// this month (done, half done, can't be done), with the report and any
// products ordered -- so whoever takes the payment sees it first.
// Renders nothing when there's no such work. One tappable line until opened,
// so it doesn't push the payment form off a phone screen.
export function MonthTasksSummary({ subscriberId }: { subscriberId: string }) {
  const [tasks, setTasks] = useState<TaskWithRelations[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setTasks([])
    setOpen(false)
    listSubscriberTasksThisMonth(subscriberId)
      .then((rows) => {
        if (!cancelled) setTasks(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [subscriberId])

  if (tasks.length === 0) return null

  return (
    <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-sm font-semibold text-blue-800"
      >
        <Wrench size={14} />
        Work done this month ({tasks.length})
        <ChevronDown size={14} className={`ml-auto ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-1.5 mb-1 space-y-1.5">
        {tasks.map((t) => {
          const orders = t.task_product_orders.filter((o) => o.status !== 'rejected')
          return (
            <div key={t.id} className="rounded-lg bg-white px-2.5 py-1.5 text-sm">
              <div className="flex items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[t.status]}`}>
                  {STATUS_LABEL[t.status]}
                </span>
                <span className="text-xs text-neutral-400">
                  {t.status_changed_at ? formatDateTime(t.status_changed_at) : ''}
                  {t.status_changed_staff ? ` · ${t.status_changed_staff.username}` : ''}
                </span>
              </div>
              <p className="text-neutral-800">{t.problem}</p>
              {t.report && <p className="text-xs text-blue-700">Report: {t.report}</p>}
              {orders.length > 0 && (
                <p className="text-xs text-neutral-500">
                  Products: {orders.map((o) => `${orderLabel(o)}${o.status === 'requested' ? ' (not confirmed)' : ''}`).join(', ')}
                </p>
              )}
            </div>
          )
        })}
      </div>}
    </div>
  )
}
