import type { ConnectionStatus } from './subscribers'

// One row of the parsed Excel file, keyed by the exact header names the ISP
// panel's export uses. Matched by header name, not column position, so a
// future export with reordered/extra columns still works.
export interface RawImportRow {
  Username: string
  Name: string
  Password: string
  Address: string
  Mobile: string
  Note: string
  Reseller: string
  Expiry: string | Date
  Service: string
  Blocked: string | number
  Switch: string
  'Date Created': string | Date
  Price: string | number
  Balance: string | number
  Region: string
  Building: string
  Nationality: string
  'Mac Address': string
  Collector: string
}

export type RowIssue =
  | { type: 'missing_username' }
  | { type: 'duplicate_username' }

export interface ParsedRow {
  rowIndex: number // 1-based position in the source file, for display
  externalUsername: string
  name: string
  phone: string | null
  notes: string | null
  connectionStatus: ConnectionStatus
  expiryDate: string | null // YYYY-MM-DD
  connectionDate: string | null // YYYY-MM-DD
  resellerName: string
  serviceName: string
  collectorName: string | null
  address: { line1: string | null; line2: string | null; region: string | null } | null
  importMetadata: { password: string | null; switch: string | null; mac_address: string | null; nationality: string | null }
  issues: RowIssue[]
  existingSubscriberId: string | null // set once matched against current DB state
}

export interface ImportBatchRow {
  external_username: string
  name: string
  phone: string | null
  notes: string | null
  connection_status: ConnectionStatus
  expiry_date: string | null
  connection_date: string | null
  service_id: string
  has_collector: boolean
  default_collector_id: string | null
  address: { line1: string | null; line2: string | null; region: string | null } | null
  import_metadata: Record<string, unknown>
}

export interface ImportLog {
  id: string
  staff_id: string | null
  filename: string
  rows_total: number
  rows_created: number
  rows_updated: number
  rows_skipped: number
  skipped: { row: number; username: string; reason: string }[]
  created_at: string
}
