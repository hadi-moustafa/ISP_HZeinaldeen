import type { ConnectionStatus, Nationality } from './subscribers'

// One row of the parsed Excel file, keyed by the exact header names the ISP
// panel's export uses. Matched by header name, not column position, so a
// future export with reordered/extra columns still works. Reseller ->
// owners (who the account belongs to) and Company -> companies (the
// network operator) are deliberately separate fields -- Company also
// disambiguates which Service row to use when a service name exists under
// more than one company.
//
// Company is NOT a column here (client removed it from the export): every
// row in a sheet belongs to one company, named by the sheet's own tab title
// (e.g. a sheet titled "Nova" means every row is Nova). See
// `companyNameFromSheet` in lib/api/import.ts.
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

export type CanonicalHeader = keyof RawImportRow

// Maps a raw header exactly as it appears in the uploaded file to the
// canonical field it feeds -- '' means "don't import this column". Built
// automatically from a best-guess match (same wording, different casing/
// spacing/order tolerated) and then editable by the admin before any row
// data is parsed, so a header this file's exporter phrases differently
// never just silently reads blank.
export type ColumnMapping = Record<string, CanonicalHeader | ''>

export type RowIssue =
  | { type: 'missing_username' }
  | { type: 'duplicate_username' }
  // Fires on every row at once, not per-row -- the sheet's own tab title
  // has to be non-blank since it's the only source of the company name now.
  | { type: 'missing_company' }

export interface ParsedRow {
  rowIndex: number // 1-based position in the source file, for display
  externalUsername: string
  name: string
  phone: string | null
  notes: string | null
  connectionStatus: ConnectionStatus
  expiryDate: string | null // YYYY-MM-DD
  connectionDate: string | null // YYYY-MM-DD
  ownerName: string | null // from Reseller
  companyName: string // from the sheet's tab title -- also disambiguates Service matches
  serviceName: string
  collectorName: string | null
  address: { line1: string | null; region: string | null } | null
  building: string | null
  password: string | null
  switchValue: string | null
  macAddress: string | null
  price: number | null
  balance: number | null
  nationality: Nationality | null
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
  company_id: string
  owner_name: string | null
  has_collector: boolean
  default_collector_id: string | null
  address: { line1: string | null; region: string | null } | null
  building: string | null
  password: string | null
  switch: string | null
  mac_address: string | null
  price: number | null
  balance: number | null
  nationality: Nationality | null
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
