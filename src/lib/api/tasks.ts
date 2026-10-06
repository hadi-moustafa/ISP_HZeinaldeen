import { supabase } from '../supabase'
import { fetchAllRows } from './fetchAll'
import type { TaskInput, TaskStatus, TaskWithRelations } from '../../types/tasks'
import { UNFINISHED_STATUSES } from '../tasks'

const TASK_SELECT = `
  *,
  assigned_staff:staff!assigned_to(username),
  status_changed_staff:staff!status_changed_by(username),
  task_product_orders(
    id, task_id, product_id, quantity, note, status, movement_id, handled_at, created_at,
    products(name, product_type, sell_price),
    requested_by_staff:staff!requested_by(username)
  )
`

function sortOrders(tasks: TaskWithRelations[]) {
  for (const t of tasks) t.task_product_orders.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return tasks
}

// Admin: every task that's still on someone's list (open, in progress or
// half done).
export async function listUnfinishedTasks(): Promise<TaskWithRelations[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .in('status', UNFINISHED_STATUSES)
    .order('created_at')
  if (error) throw error
  return sortOrders(data as unknown as TaskWithRelations[])
}

// Admin: closed tasks (done / can't be done), newest first.
export async function listFinishedTasks(limit = 200): Promise<TaskWithRelations[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .in('status', ['done', 'cant_do'])
    .order('finished_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return sortOrders(data as unknown as TaskWithRelations[])
}

// Technician: their unfinished tasks -- assigned to them, or to nobody.
export async function listTechnicianOpenTasks(staffId: string): Promise<TaskWithRelations[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .in('status', UNFINISHED_STATUSES)
    .or(`assigned_to.eq.${staffId},assigned_to.is.null`)
    .order('created_at')
  if (error) throw error
  return sortOrders(data as unknown as TaskWithRelations[])
}

// Technician: tasks they closed themselves, newest first.
export async function listTechnicianFinishedTasks(staffId: string, limit = 50): Promise<TaskWithRelations[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .in('status', ['done', 'cant_do'])
    .eq('status_changed_by', staffId)
    .order('finished_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return sortOrders(data as unknown as TaskWithRelations[])
}

// Counts without fetching rows. assignedOrClosedBy narrows to one
// technician (closed by them); omit for everyone.
export async function countTasks(statuses: TaskStatus[], closedBy?: string): Promise<number> {
  let q = supabase.from('tasks').select('id', { count: 'exact', head: true }).in('status', statuses)
  if (closedBy) q = q.eq('status_changed_by', closedBy)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

// Tasks closed or reported on for this subscriber in the current Beirut
// month -- the summary shown in the Pay modal before taking payment.
export async function listSubscriberTasksThisMonth(subscriberId: string): Promise<TaskWithRelations[]> {
  const since = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('subscriber_id', subscriberId)
    .neq('status', 'open')
    .gte('status_changed_at', since)
    .order('status_changed_at', { ascending: false })
  if (error) throw error
  const month = beirutMonth(new Date().toISOString())
  return sortOrders(
    (data as unknown as TaskWithRelations[]).filter(
      (t) => t.status_changed_at && beirutMonth(t.status_changed_at) === month,
    ),
  )
}

function beirutMonth(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' }).slice(0, 7)
}

export async function createTask(input: TaskInput, staffId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...input, created_by: staffId })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function updateTask(id: string, input: Partial<TaskInput>) {
  const { error } = await supabase.from('tasks').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteTask(id: string) {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// Technician's Done / Half done / Can't be done (with their report), or
// the admin reopening a task (status 'open'). status_changed_at and
// finished_at are stamped by the DB trigger.
export async function setTaskStatus(id: string, status: TaskStatus, report: string | null, staffId: string) {
  const { error } = await supabase
    .from('tasks')
    .update({ status, report, status_changed_by: staffId })
    .eq('id', id)
  if (error) throw error
}

// Technician accepts a task: it goes in progress, and an unassigned
// ("any technician") task becomes theirs so nobody else picks it up too.
// Only from 'open', so two technicians accepting at once can't both win.
export async function acceptTask(task: { id: string; assigned_to: string | null }, staffId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'in_progress', status_changed_by: staffId, assigned_to: task.assigned_to ?? staffId })
    .eq('id', task.id)
    .eq('status', 'open')
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('This task was already taken or changed. Refresh the list.')
}

export async function saveTaskReport(id: string, report: string | null) {
  const { error } = await supabase.from('tasks').update({ report }).eq('id', id)
  if (error) throw error
}

export async function addTaskOrder(input: {
  taskId: string
  productId: string
  quantity: number
  note: string | null
  staffId: string
}) {
  const { error } = await supabase.from('task_product_orders').insert({
    task_id: input.taskId,
    product_id: input.productId,
    quantity: input.quantity,
    note: input.note,
    requested_by: input.staffId,
  })
  if (error) throw error
}

// Only a still-pending request can be withdrawn.
export async function deleteTaskOrder(id: string) {
  const { error } = await supabase.from('task_product_orders').delete().eq('id', id).eq('status', 'requested')
  if (error) throw error
}

export async function confirmTaskOrder(id: string, staffId: string, totalAmount: number | null, amountPaid: number) {
  const { error } = await supabase.rpc('confirm_task_product_order', {
    p_order_id: id,
    p_staff_id: staffId,
    p_total_amount: totalAmount,
    p_amount_paid: amountPaid,
  })
  if (error) throw error
}

export async function rejectTaskOrder(id: string, staffId: string) {
  const { error } = await supabase
    .from('task_product_orders')
    .update({ status: 'rejected', handled_by: staffId, handled_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'requested')
  if (error) throw error
}

export interface TaskSubscriberOption {
  id: string
  name: string
  phone: string | null
  address: string | null
  building: string | null
  addresses: { name: string } | null
}

// Everyone, paged (PostgREST caps at 1000), with what the task form
// pre-fills from.
export function listTaskSubscriberOptions() {
  return fetchAllRows<TaskSubscriberOption>((from, to) =>
    supabase.from('subscribers').select('id, name, phone, address, building, addresses(name)').order('name').range(from, to),
  )
}
