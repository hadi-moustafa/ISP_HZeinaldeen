import type { Task, TaskPriority, TaskProductOrder, TaskStatus } from '../types/tasks'

// Calendar date in Beirut (the DB clock is UTC), YYYY-MM-DD.
function beirutDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' })
}

// Still on someone's list: not accepted yet, accepted, or half done.
export const UNFINISHED_STATUSES: TaskStatus[] = ['open', 'in_progress', 'half_done']

export function isUnfinishedTask(task: Pick<Task, 'status'>): boolean {
  return UNFINISHED_STATUSES.includes(task.status)
}

// Calendar date in Beirut of "now", YYYY-MM-DD.
export function beirutToday() {
  return beirutDay(new Date().toISOString())
}

export function isCreatedToday(task: Pick<Task, 'created_at'>): boolean {
  return beirutDay(task.created_at) === beirutToday()
}

const RANK: Record<TaskPriority, number> = { normal: 0, high: 1, urgent: 2 }

// An unfinished task still waiting from a previous day is at least 'high'
// (client rule: undone for a day -> priority on the second day). Computed,
// never stored, so it needs no cron.
export function isOverdueTask(task: Pick<Task, 'status' | 'created_at'>): boolean {
  if (!isUnfinishedTask(task)) return false
  return beirutDay(task.created_at) < beirutToday()
}

export function effectivePriority(task: Pick<Task, 'status' | 'created_at' | 'priority'>): TaskPriority {
  if (isOverdueTask(task) && RANK[task.priority] < RANK.high) return 'high'
  return task.priority
}

// Highest priority first, then oldest first.
export function compareTasks(a: Task, b: Task) {
  const byPriority = RANK[effectivePriority(b)] - RANK[effectivePriority(a)]
  return byPriority !== 0 ? byPriority : a.created_at.localeCompare(b.created_at)
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = { normal: 'Normal', high: 'High', urgent: 'Urgent' }
export const PRIORITY_CLASS: Record<TaskPriority, string> = {
  normal: 'bg-neutral-100 text-neutral-600',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'To do',
  in_progress: 'In progress',
  half_done: 'Half done',
  done: 'Done',
  cant_do: "Can't be done",
}
export const STATUS_CLASS: Record<TaskStatus, string> = {
  open: 'bg-neutral-100 text-neutral-600',
  in_progress: 'bg-blue-100 text-blue-700',
  half_done: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  cant_do: 'bg-red-100 text-red-700',
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Beirut',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// "Router × 2", "Cable × 30 m"
export function orderLabel(o: TaskProductOrder) {
  const name = o.products?.name ?? 'Product'
  const unit = o.products?.product_type === 'cable' ? ' m' : ''
  return `${name} × ${o.quantity}${unit}`
}
