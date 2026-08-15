// Shared between SubscribersListPage's own filter bar and the dashboard's
// search-with-filters panel, so both stay in lockstep with a single list of
// fields instead of two copies that could drift apart.
export type FilterField =
  | 'name'
  | 'id'
  | 'owner'
  | 'username'
  | 'phone'
  | 'nationality'
  | 'notes'
  | 'collector'
  | 'company'
  | 'service'
  | 'region'
  | 'status'
  | 'expiry'
  | 'connection'

export const FILTER_FIELDS: { value: FilterField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'id', label: 'ID' },
  { value: 'owner', label: 'Owner' },
  { value: 'username', label: 'Username' },
  { value: 'phone', label: 'Phone' },
  { value: 'nationality', label: 'Nationality' },
  { value: 'notes', label: 'Notes' },
  { value: 'collector', label: 'Collector' },
  { value: 'company', label: 'Company' },
  { value: 'service', label: 'Service' },
  { value: 'region', label: 'Region' },
  { value: 'status', label: 'Connection status' },
  { value: 'expiry', label: 'Expiry date' },
  { value: 'connection', label: 'Connection date' },
]

export const TEXT_FILTER_FIELDS: FilterField[] = ['name', 'id', 'owner', 'username', 'phone', 'notes']
