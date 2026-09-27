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
import { normalizePhone } from '../phone'

// --- Step 1: read headers + apply a column mapping -------------------------

// The canonical column names this importer understands, and what each feeds.
// Column position in the file never matters -- sheet_to_json already keys
// rows by header text -- only the wording does, and even that tolerates
// incidental drift (casing/whitespace/order) via the normalized lookup
// below. Anything a file's exporter phrases differently still lands here
// because the admin gets to fix the mapping before any row data is read.
// Company is deliberately absent here -- it's no longer a column in the
// file, it's the sheet's own tab title (see companyNameFromSheet below).
export const CANONICAL_HEADERS: CanonicalHeader[] = [
  'Username', 'Name', 'Password', 'Address', 'Mobile', 'Note', 'Reseller',
  'Expiry', 'Service', 'Blocked', 'Switch', 'Date Created',
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

// Fields a usable import can't proceed without. Company isn't here -- it
// comes from the sheet's tab title, not a column.
export const REQUIRED_CANONICAL_HEADERS: CanonicalHeader[] = ['Username', 'Name']

function normalizeHeaderKey(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, ' ')
}

const CANONICAL_BY_NORMALIZED_KEY = new Map(
  CANONICAL_HEADERS.map((h) => [normalizeHeaderKey(h), h]),
)

export interface WorkbookData {
  headers: string[] // raw header text, in file order
  rawRows: Record<string, unknown>[] // each row keyed by that raw header text
  sheetName: string // the sheet's own tab title -- doubles as the company name for every row
}

export async function readWorkbook(file: File): Promise<WorkbookData> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0] ?? ''
  const sheet = workbook.Sheets[sheetName]
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
  return { headers, rawRows, sheetName: sheetName.trim() }
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
  // Day-first text dates (05/09/2026, 5-9-26, 05.09.2026), the way dates are
  // written in Lebanon. `new Date('05/09/2026')` would read it US-style as
  // May 9th, so these are parsed explicitly and never fall through.
  const dayFirst = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (dayFirst) {
    const day = Number(dayFirst[1])
    const month = Number(dayFirst[2])
    const year = dayFirst[3].length === 2 ? 2000 + Number(dayFirst[3]) : Number(dayFirst[3])
    const check = new Date(year, month - 1, day)
    if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
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

export function normalizeRows(rawRows: RawImportRow[], companyName: string): ParsedRow[] {
  const trimmedCompanyName = companyName.trim()
  // Keyed case/space-insensitively: "Ali" and "ali " are the same account
  // (the DB enforces this too -- see 0032).
  const seenUsernames = new Map<string, number>() // normalized username -> first row position
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
      companyName: trimmedCompanyName,
      serviceName: String(raw.Service ?? '').trim(),
      collectorName: blankToNull(raw.Collector),
      // The "region" key here is really "which predefined address entry to
      // match/create" -- despite the name (left over from before the region
      // concept was replaced by the addresses dropdown in
      // 0020_addresses_and_collect_track.sql), it must be keyed off the
      // Excel file's own Address column, not its Region column. The app's
      // subscriber form and every list/card display subscribers.addresses
      // (the address_id lookup) as "the address" -- the free-text
      // subscribers.address column this also populates is legacy/unused.
      // Previously this read raw.Region here, so every imported subscriber's
      // displayed address was actually the Excel file's Region value.
      address: blankToNull(raw.Address) ? { line1: blankToNull(raw.Address), region: blankToNull(raw.Address) } : null,
      // The file's actual Region column -- scoped under whichever address
      // this row resolves to, server-side (see import_subscribers_batch in
      // 0027_regions_under_address.sql).
      regionName: blankToNull(raw.Region),
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
    if (!row.name) row.issues.push({ type: 'missing_name' })
    if (!row.companyName) row.issues.push({ type: 'missing_company' })
    return row
  })

  for (const row of rows) {
    if (!row.externalUsername) continue
    const key = normalizeName(row.externalUsername)
    if (seenUsernames.has(key)) {
      row.issues.push({ type: 'duplicate_username' })
      const first = rows[seenUsernames.get(key)!]
      if (!first.issues.some((i) => i.type === 'duplicate_username')) first.issues.push({ type: 'duplicate_username' })
    } else {
      seenUsernames.set(key, rows.indexOf(row))
    }
  }

  return rows
}

// --- Step 3: reference data + matching -------------------------------------

// What an existing subscriber looks like right now -- the import preview
// compares against it to show exactly what a re-import would change.
export interface ExistingSubscriberSnapshot {
  id: string
  name: string
  phone: string | null
  expiry_date: string | null
  connection_status: string
  service_id: string | null
  price: number | null
}

export interface ImportReferenceData {
  companies: Company[]
  services: ServiceWithCompany[]
  collectors: Collector[]
  existingByUsername: Map<string, ExistingSubscriberSnapshot> // normalized username -> current values
}

// PostgREST returns at most 1000 rows per request, so a plain select would
// silently stop matching existing subscribers past that many (and try to
// re-create them). Page through until a short page comes back.
async function fetchAllExistingSubscribers() {
  const pageSize = 1000
  const all: (ExistingSubscriberSnapshot & { external_username: string })[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('subscribers')
      .select('id, external_username, name, phone, expiry_date, connection_status, service_id, price')
      .not('external_username', 'is', null)
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    all.push(...(data as (ExistingSubscriberSnapshot & { external_username: string })[]))
    if (!data || data.length < pageSize) return all
  }
}

export async function loadImportReferenceData(): Promise<ImportReferenceData> {
  const [companiesRes, servicesRes, collectorsRes, existing] = await Promise.all([
    supabase.from('companies').select('*').order('name'),
    supabase.from('services').select('*, companies(name)').order('name'),
    supabase.from('collectors').select('*').order('name'),
    fetchAllExistingSubscribers(),
  ])
  if (companiesRes.error) throw companiesRes.error
  if (servicesRes.error) throw servicesRes.error
  if (collectorsRes.error) throw collectorsRes.error

  const existingByUsername = new Map<string, ExistingSubscriberSnapshot>()
  for (const s of existing) {
    existingByUsername.set(normalizeName(s.external_username), s)
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

// companyResolutions: the admin's mapping for a sheet title that doesn't
// match a company by name. Services are only ever matched within the
// file's company -- a same-named service under another company is never
// picked (that would bill the wrong company and break the company/service
// link), it's reported as unresolved instead.
export function matchRows(
  rows: ParsedRow[],
  ref: ImportReferenceData,
  companyResolutions: Map<string, string> = new Map(),
) {
  for (const row of rows) {
    row.existingSubscriberId = ref.existingByUsername.get(normalizeName(row.externalUsername))?.id ?? null
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
  const unmatchedCollectors = new Set<string>()

  for (const row of rows) {
    const companyKey = normalizeName(row.companyName)
    const companyId = companyByName.get(companyKey)?.id ?? companyResolutions.get(companyKey) ?? null
    if (row.companyName && !companyByName.has(companyKey)) {
      unresolvedCompanies.add(row.companyName)
    }
    // Until the company is known there's nothing to match services against;
    // the preview asks for the company first.
    if (companyId && row.serviceName) {
      const inCompany = (serviceByName.get(normalizeName(row.serviceName)) ?? []).some((s) => s.comp_id === companyId)
      if (!inCompany) unresolvedServices.add(row.serviceName)
    }
    // Owner (Reseller) matching failures don't block import -- owners are
    // auto-created by name inside the RPC. Collectors aren't created, and an
    // unmatched one leaves the subscriber's collector untouched, so they're
    // reported (not blocking) instead of silently ignored.
    if (row.collectorName && !collectorByName.has(normalizeName(row.collectorName))) {
      unmatchedCollectors.add(row.collectorName)
    }
  }

  return {
    companyByName,
    collectorByName,
    serviceByName,
    unresolvedCompanies: Array.from(unresolvedCompanies),
    unresolvedServices: Array.from(unresolvedServices),
    unmatchedCollectors: Array.from(unmatchedCollectors),
  }
}

// Fields the app manages itself for an existing subscriber. A re-import
// leaves them alone unless the admin ticks them (see 0032).
export type ProtectedField = 'expiry' | 'status' | 'service' | 'price'

export interface ImportOptions {
  update_expiry: boolean
  update_status: boolean
  update_service: boolean
  update_price: boolean
}

export interface ExistingRowChange {
  row: ParsedRow
  changes: { field: 'name' | 'phone' | ProtectedField; from: string; to: string }[]
}

// What importing would change on each existing subscriber, field by field
// -- the same rules the RPC applies (blank never wipes, a 0 price is not a
// price, phones compared after normalization).
export function diffExistingRows(
  rows: ParsedRow[],
  ref: ImportReferenceData,
  resolveServiceId: (row: ParsedRow) => string | null,
): ExistingRowChange[] {
  const serviceName = new Map(ref.services.map((s) => [s.id, s.name]))
  const out: ExistingRowChange[] = []
  for (const row of rows) {
    const current = ref.existingByUsername.get(normalizeName(row.externalUsername))
    if (!current) continue
    const changes: ExistingRowChange['changes'] = []
    if (row.name && row.name !== current.name) changes.push({ field: 'name', from: current.name, to: row.name })
    const phone = normalizePhone(row.phone)
    if (phone && phone !== current.phone) changes.push({ field: 'phone', from: current.phone ?? '—', to: phone })
    if (row.expiryDate && row.expiryDate !== current.expiry_date)
      changes.push({ field: 'expiry', from: current.expiry_date ?? '—', to: row.expiryDate })
    if (row.connectionStatus !== current.connection_status)
      changes.push({ field: 'status', from: current.connection_status, to: row.connectionStatus })
    const serviceId = resolveServiceId(row)
    if (serviceId && serviceId !== current.service_id)
      changes.push({
        field: 'service',
        from: (current.service_id && serviceName.get(current.service_id)) || '—',
        to: serviceName.get(serviceId) ?? row.serviceName,
      })
    if (row.price && row.price > 0 && row.price !== Number(current.price ?? 0))
      changes.push({ field: 'price', from: current.price ? String(current.price) : '—', to: String(row.price) })
    if (changes.length > 0) out.push({ row, changes })
  }
  return out
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

// Only a service belonging to this row's company counts as a match;
// otherwise the admin's explicit mapping (itself limited to that company's
// services in the preview) is used, or nothing.
export function resolveServiceIdForRow(row: ParsedRow, ctx: ServiceResolutionContext): string | null {
  const serviceKey = normalizeName(row.serviceName)
  const companyId = resolveCompanyIdForRow(row, ctx)
  const match = (ctx.serviceByName.get(serviceKey) ?? []).find((c) => c.comp_id === companyId)
  return match?.id ?? ctx.serviceOverrides.get(serviceKey) ?? null
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
        region_name: row.regionName,
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
  options: ImportOptions,
): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('import_subscribers_batch', {
    p_rows: rows,
    p_staff_id: staffId,
    p_filename: filename,
    p_rows_total: rowsTotal,
    p_skipped: skipped,
    p_options: options,
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
