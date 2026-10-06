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

// Turns what the admin pasted into a link that opens a map: a full link
// (Google Maps share links like maps.app.goo.gl/..., or any http(s) map
// link) as is, a link missing its https:// gets it, and bare coordinates
// ("33.89, 35.50") become a Google Maps search. On a phone, Google Maps
// links open the Google Maps app when it's installed. Returns null for
// anything that isn't one of these.
export function mapsLink(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const coords = text.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (coords) return `https://www.google.com/maps/search/?api=1&query=${coords[1]},${coords[2]}`
  const withScheme = /^https?:\/\//i.test(text) ? text : /^[\w-]+(\.[\w-]+)+\//.test(text) ? `https://${text}` : null
  if (!withScheme) return null
  try {
    const url = new URL(withScheme)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
