export type ConnectionStatus = 'active' | 'suspended' | 'cancelled'

export interface Subscriber {
  id: string
  name: string
  phone: string | null
  national_id: string | null
  service_id: string | null
  owner_id: string | null
  default_collector_id: string | null
  connection_status: ConnectionStatus
  expiry_date: string | null
  connection_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface SubscriberWithRelations extends Subscriber {
  owners: { name: string } | null
  default_collector: { name: string } | null
  services: { name: string; sell_price: number; companies: { name: string } | null } | null
}

export interface SubscriberAddress {
  id: string
  subscriber_id: string
  label: string | null
  line1: string | null
  line2: string | null
  city: string | null
  region: string | null
  country: string | null
  is_primary: boolean
  created_at: string
  updated_at: string
}

export type DebtFilterMode = 'any' | 'in_debt' | 'paid_up'

export interface SubscriberFilters {
  search: string
  ownerId: string
  collectorId: string
  companyId: string
  serviceId: string
  status: ConnectionStatus | ''
  debtMode: DebtFilterMode
  expiryFrom: string
  expiryTo: string
}

export const emptyFilters: SubscriberFilters = {
  search: '',
  ownerId: '',
  collectorId: '',
  companyId: '',
  serviceId: '',
  status: '',
  debtMode: 'any',
  expiryFrom: '',
  expiryTo: '',
}
