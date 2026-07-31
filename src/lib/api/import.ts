import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import type {
  RawImportRow,
  CanonicalHeader,
  ColumnMapping,
  ParsedRow,
  ImportBatchRow,
  ImportLog,
} from '../../types/import'
import type { Company, Collector, ServiceWithCompany } from '../../types/reference'

// --- Step 1: read headers + apply a column mapping -------------------------

// The canonical column names this importer understands, and what each feeds.
// Column position in the file never matters -- sheet_to_json already keys
// rows by header text -- only the wording does, and even that tolerates
// incidental drift (casing/whitespace/order) via the normalized lookup
// below. Anything a file's exporter phrases differently still lands here
// because the admin gets to fix the mapping before any row data is read.
export const CANONICAL_HEADERS: CanonicalHeader[] = [
  'Username', 'Name', 'Password', 'Address', 'Mobile', 'Note', 'Reseller',
  'Expiry', 'Service', 'Company', 'Blocked', 'Switch', 'Date Created',
  'Price', 'Balance', 'Region', 'Building', 'Nationality', 'Mac Address',
  'Collector',
]

export const CANONICAL_HEADER_LABELS: Record<CanonicalHeader, string> = {
  Username: 'Username (dedupe key)',
  Name: 'Subscriber name',
  Password: 'Password',
  Address: 'Address line',
  Mobile: 'Phone',
  Note: 'Notes',
  Reseller: 'Owner (Reseller)',
  Expiry: 'Expiry date',
  Service: 'Service / plan',
  Company: 'Company (network operator)',
  Blocked: 'Blocked flag (1 = suspended)',
  Switch: 'Switch',
  'Date Created': 'Connection date',
  Price: "Price (subscriber's own sell price)",
  Balance: "Balance (subscriber's own cost to company)",
  Region: 'Region',
  Building: 'Building',
  Nationality: 'Nationality (Lebanese/Syrian)',
  'Mac Address': 'MAC address',
  Collector: 'Collector',
}

// Fields a usable import can't proceed without.
export const REQUIRED_CANONICAL_HEADERS: CanonicalHeader[] = ['Username', 'Name', 'Company']

function normalizeHeaderKey(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, ' ')
}

const CANONICAL_BY_NORMALIZED_KEY = new Map(
  CANONICAL_HEADERS.map((h) => [normalizeHeaderKey(h), h]),
)

export interface WorkbookData {
  headers: string[] // raw header text, in file order
  rawRows: Record<string, unknown>[] // each row keyed by that raw header text
}

export async function readWorkbook(file: File): Promise<WorkbookData> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  // defval keeps every declared column present (as '') even when a cell is
  // blank, so downstream code never has to guess between "missing key" and
  // "blank value".
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  })
  // Read the header row directly (header: 1 -> arrays, not objects) rather
  // than trusting Object.keys(rawRows[0]) -- the sheet may have zero data
  // rows, and this still gives every column in its real file order.
  const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false })[0] ?? []
  const headers = headerRow.map((h) => String(h ?? '').trim()).filter(Boolean)
  return { headers, rawRows }
}

// Best-guess mapping: any header whose wording matches a canonical field
// (ignoring case/whitespace/order) maps to it automatically; anything else
// starts unmapped ('') for the admin to assign or leave ignored.
export function defaultColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const header of headers) {
    mapping[header] = CANONICAL_BY_NORMALIZED_KEY.get(normalizeHeaderKey(header)) ?? ''
  }
  return mapping
}

// Re-keys every row from its raw file headers onto the canonical fields the
// rest of the importer expects, per the (admin-confirmed) mapping.
export function applyColumnMapping(rawRows: Record<string, unknown>[], mapping: ColumnMapping): RawImportRow[] {
  return rawRows.map((row) => {
    const mapped: Record<string, unknown> = {}
    for (const [header, value] of Object.entries(row)) {
      const canonical = mapping[header]
      if (canonical) mapped[canonical] = value
    }
    return mapped as unknown as RawImportRow
  })
}

// Formats using local getters, not toISOString(): these are date-only values
// with no time-of-day meaning, but SheetJS/JS Date objects for them land at
// local midnight -- toISOString() converts to UTC first and silently rolls
// the date back a day in any timezone ahead of UTC (confirmed live: Beirut
// UTC+3 turned an Aug 15 expiry into Aug 14).
function formatDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseExcelDate(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return formatDateLocal(value)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  const str = String(value).trim()
  if (!str) return null
  // Already yyyy-mm-dd (dateNF above) or a parseable date string
  const match = str.match(/^\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const parsed = new Date(str)
  if (Number.isNaN(parsed.getTime())) return null
  return formatDateLocal(parsed)
}

function blankToNull(value: unknown): string | null {
  const str = String(value ?? '').trim()
  return str === '' ? null : str
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

// Common phrasing variants map to the two values the app's nationality
// dropdown accepts; anything else is left blank rather than blocking the
// import (nationality isn't required for billing to work).
function normalizeNationality(value: unknown): 'Lebanese' | 'Syrian' | null {
  const str = String(value ?? '').trim().toLowerCase()
  if (!str) return null
  if (str.startsWith('leb') || str === 'lb') return 'Lebanese'
  if (str.startsWith('syr') || str === 'sy') return 'Syrian'
  return null
}

// --- Step 2: normalize raw rows into the app's shape ----------------------

export function normalizeRows(rawRows: RawImportRow[]): ParsedRow[] {
  const seenUsernames = new Map<string, number>() // username -> first rowIndex seen
  const rows: ParsedRow[] = rawRows.map((raw, i) => {
    const rowIndex = i + 2 // header is row 1 in the source file
    const externalUsername = String(raw.Username ?? '').trim()
    const blocked = String(raw.Blocked ?? '').trim()

    const row: ParsedRow = {
      rowIndex,
      externalUsername,
      name: String(raw.Name ?? '').trim(),
      phone: blankToNull(raw.Mobile),
      notes: blankToNull(raw.Note),
      connectionStatus: blocked === '1' ? 'suspended' : 'active',
      expiryDate: parseExcelDate(raw.Expiry),
      connectionDate: parseExcelDate(raw['Date Created']),
      ownerName: blankToNull(raw.Reseller),
      companyName: String(raw.Company ?? '').trim(),
      serviceName: String(raw.Service ?? '').trim(),
      collectorName: blankToNull(raw.Collector),
      address:
        blankToNull(raw.Address) || blankToNull(raw.Region)
          ? { line1: blankToNull(raw.Address), region: blankToNull(raw.Region) }
          : null,
      building: blankToNull(raw.Building),
      password: blankToNull(raw.Password),
      switchValue: blankToNull(raw.Switch),
      macAddress: blankToNull(raw['Mac Address']),
      price: parseNumber(raw.Price),
      balance: parseNumber(raw.Balance),
      nationality: normalizeNationality(raw.Nationality),
      issues: [],
      existingSubscriberId: null,
    }

    if (!externalUsername) row.issues.push({ type: 'missing_username' })
    if (!row.companyName) row.issues.push({ type: 'missing_company' })
    return row
  })

  for (const row of rows) {
    if (!row.externalUsername) continue
    if (seenUsernames.has(row.externalUsername)) {
      row.issues.push({ type: 'duplicate_username' })
      rows[seenUsernames.get(row.externalUsername)!].issues.push({ type: 'duplicate_username' })
    } else {
      seenUsernames.set(row.externalUsername, rows.indexOf(row))
    }
  }

  return rows
}

// --- Step 3: reference data + matching -------------------------------------

export interface ImportReferenceData {
  companies: Company[]
  services: ServiceWithCompany[]
  collectors: Collector[]
  existingByUsername: Map<string, string> // external_username -> subscriber id
}

export async function loadImportReferenceData(): Promise<ImportReferenceData> {
  const [companiesRes, servicesRes, collectorsRes, subscribersRes] = await Promise.all([
    supabase.from('companies').select('*').order('name'),
    supabase.from('services').select('*, companies(name)').order('name'),
    supabase.from('collectors').select('*').order('name'),
    supabase.from('subscribers').select('id, external_username').not('external_username', 'is', null),
  ])
  if (companiesRes.error) throw companiesRes.error
  if (servicesRes.error) throw servicesRes.error
  if (collectorsRes.error) throw collectorsRes.error
  if (subscribersRes.error) throw subscribersRes.error

  const existingByUsername = new Map<string, string>()
  for (const s of subscribersRes.data as { id: string; external_username: string }[]) {
    existingByUsername.set(s.external_username, s.id)
  }

  return {
    companies: companiesRes.data as Company[],
    services: servicesRes.data as unknown as ServiceWithCompany[],
    collectors: collectorsRes.data as Collector[],
    existingByUsername,
  }
}

function normalizeName(name: string) {
  return name.trim().toLowerCase()
}

export function matchRows(rows: ParsedRow[], ref: ImportReferenceData) {
  for (const row of rows) {
    row.existingSubscriberId = ref.existingByUsername.get(row.externalUsername) ?? null
  }

  const companyByName = new Map(ref.companies.map((c) => [normalizeName(c.name), c]))
  const collectorByName = new Map(ref.collectors.map((c) => [normalizeName(c.name), c]))
  const serviceByName = new Map<string, ServiceWithCompany[]>()
  for (const s of ref.services) {
    const key = normalizeName(s.name)
    const list = serviceByName.get(key) ?? []
    list.push(s)
    serviceByName.set(key, list)
  }

  const unresolvedCompanies = new Set<string>()
  const unresolvedServices = new Set<string>()

  for (const row of rows) {
    if (row.companyName && !companyByName.has(normalizeName(row.companyName))) {
      unresolvedCompanies.add(row.companyName)
    }
    if (row.serviceName && !serviceByName.has(normalizeName(row.serviceName))) {
      unresolvedServices.add(row.serviceName)
    }
    // Owner (Reseller) and Collector matching failures don't block import.
    // Owner is auto-created by name inside the RPC (low-stakes, just a
    // label); Collector falls back to leaving the subscriber's existing
    // collector untouched, same as a blank Collector column.
  }

  return {
    companyByName,
    collectorByName,
    serviceByName,
    unresolvedCompanies: Array.from(unresolvedCompanies),
    unresolvedServices: Array.from(unresolvedServices),
  }
}

// --- Step 4: build the RPC payload once every row is resolvable -----------

export interface ServiceResolutionContext {
  serviceByName: Map<string, ServiceWithCompany[]>
  companyByName: Map<string, Company>
  collectorByName: Map<string, Collector>
  companyResolutions: Map<string, string> // company name (normalized) -> company id, for admin-mapped companies
  serviceOverrides: Map<string, string> // service name (normalized) -> service id, for admin-mapped/created services
}

function resolveCompanyIdForRow(row: ParsedRow, ctx: ServiceResolutionContext): string | null {
  return (
    ctx.companyByName.get(normalizeName(row.companyName))?.id ??
    ctx.companyResolutions.get(normalizeName(row.companyName)) ??
    null
  )
}

function resolveServiceIdForRow(row: ParsedRow, ctx: ServiceResolutionContext): string | null {
  const serviceKey = normalizeName(row.serviceName)
  const candidates = ctx.serviceByName.get(serviceKey) ?? []
  if (candidates.length === 1) return candidates[0].id
  if (candidates.length > 1) {
    const companyId = resolveCompanyIdForRow(row, ctx)
    return candidates.find((c) => c.comp_id === companyId)?.id ?? candidates[0].id
  }
  return ctx.serviceOverrides.get(serviceKey) ?? null
}

export function buildBatchRows(rows: ParsedRow[], ctx: ServiceResolutionContext): ImportBatchRow[] {
  return rows
    .filter((r) => r.issues.length === 0)
    .map((row) => {
      const serviceId = resolveServiceIdForRow(row, ctx)
      if (!serviceId) throw new Error(`Row ${row.rowIndex}: service "${row.serviceName}" is unresolved`)
      const companyId = resolveCompanyIdForRow(row, ctx)
      if (!companyId) throw new Error(`Row ${row.rowIndex}: company "${row.companyName}" is unresolved`)
      const collector = row.collectorName ? ctx.collectorByName.get(normalizeName(row.collectorName)) : null

      return {
        external_username: row.externalUsername,
        name: row.name,
        phone: row.phone,
        notes: row.notes,
        connection_status: row.connectionStatus,
        expiry_date: row.expiryDate,
        connection_date: row.connectionDate,
        service_id: serviceId,
        company_id: companyId,
        owner_name: row.ownerName,
        has_collector: Boolean(collector),
        default_collector_id: collector?.id ?? null,
        address: row.address,
        building: row.building,
        password: row.password,
        switch: row.switchValue,
        mac_address: row.macAddress,
        price: row.price,
        balance: row.balance,
        nationality: row.nationality,
      }
    })
}

// --- Step 5: commit ---------------------------------------------------------

export interface ImportResult {
  created: number
  updated: number
  skipped: number
}

export async function importSubscribersBatch(
  rows: ImportBatchRow[],
  filename: string,
  staffId: string | null,
  rowsTotal: number,
  skipped: { row: number; username: string; reason: string }[],
): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('import_subscribers_batch', {
    p_rows: rows,
    p_staff_id: staffId,
    p_filename: filename,
    p_rows_total: rowsTotal,
    p_skipped: skipped,
  })
  if (error) throw error
  return data as ImportResult
}

export async function listImportLogs() {
  const { data, error } = await supabase
    .from('import_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data as ImportLog[]
}
