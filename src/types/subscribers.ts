export type ConnectionStatus = 'active' | 'suspended' | 'cancelled'
export type Nationality = 'Lebanese' | 'Syrian'

export interface Subscriber {
  id: string
  name: string
  phone: string | null
  nationality: Nationality | null
  address: string | null
  building: string | null
  region_id: string | null
  service_id: string | null
  company_id: string | null
  owner_id: string | null
  default_collector_id: string | null
  connection_status: ConnectionStatus
  expiry_date: string | null
  connection_date: string | null
  notes: string | null
  external_username: string | null
  password: string | null
  switch: string | null
  mac_address: string | null
  price: number | null
  balance: number | null
  // Current total outstanding across the subscriber's unpaid/partial
  // invoices -- kept live-synced by DB triggers (0016_billing_engine.sql),
  // the one source of truth for "in debt" app-wide.
  debt: number
  created_at: string
  updated_at: string
}

export interface SubscriberWithRelations extends Subscriber {
  owners: { name: string } | null
  default_collector: { name: string } | null
  services: { name: string; sell_price: number; paid_price: number; companies: { name: string } | null } | null
  regions: { name: string } | null
  company: { name: string } | null
}

export type DebtFilterMode = 'any' | 'in_debt' | 'paid_up'

export interface SubscriberFilters {
  search: string
  ownerId: string
  collectorId: string
  companyId: string
  serviceId: string
  regionId: string
  status: ConnectionStatus | ''
  debtMode: DebtFilterMode
  expiryFrom: string
  expiryTo: string
  phone: string
  nationality: Nationality | ''
  notes: string
  connectionFrom: string
  connectionTo: string
}

export const emptyFilters: SubscriberFilters = {
  search: '',
  ownerId: '',
  collectorId: '',
  companyId: '',
  serviceId: '',
  regionId: '',
  status: '',
  debtMode: 'any',
  expiryFrom: '',
  expiryTo: '',
  phone: '',
  nationality: '',
  notes: '',
  connectionFrom: '',
  connectionTo: '',
}
