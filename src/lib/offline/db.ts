import Dexie, { type Table } from 'dexie'

// Local mirror of exactly what a collector needs in the field: their
// assigned subscribers and those subscribers' invoices. Scoped to this
// per the kickoff doc -- admin screens (financials, inventory, company/
// service CRUD) stay online-only.
export interface CachedSubscriber {
  id: string
  name: string
  phone: string | null
  connection_status: string
  expiry_date: string | null
  service_name: string | null
  company_name: string | null
  default_collector_id: string | null
}

export interface CachedInvoice {
  id: string
  subscriber_id: string
  period_month: string
  amount_due: number
  amount_paid: number
  status: string
  due_date: string | null
  postponed_to: string | null
}

export type QueueItemType = 'payment' | 'postponement'

export interface QueueItem {
  id?: number
  type: QueueItemType
  payload: Record<string, unknown>
  created_at: string
}

class OfflineDB extends Dexie {
  subscribers!: Table<CachedSubscriber, string>
  invoices!: Table<CachedInvoice, string>
  queue!: Table<QueueItem, number>

  constructor() {
    super('isp-manager-offline')
    this.version(1).stores({
      subscribers: 'id, default_collector_id',
      invoices: 'id, subscriber_id',
      queue: '++id, type',
    })
  }
}

export const offlineDB = new OfflineDB()
