import { useEffect, useRef, useState } from 'react'
import { useStaff } from '../../context/StaffContext'
import { createService } from '../../lib/api/services'
import {
  parseWorkbookFile,
  normalizeRows,
  loadImportReferenceData,
  matchRows,
  buildBatchRows,
  importSubscribersBatch,
  listImportLogs,
  type ImportReferenceData,
} from '../../lib/api/import'
import type { ParsedRow, ImportLog } from '../../types/import'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  cardClass,
} from '../../lib/uiClasses'

type Step = 'upload' | 'preview' | 'result'

const statusLabel: Record<ParsedRow['connectionStatus'], string> = {
  active: 'Active',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
}

export function ImportPage() {
  const { staff } = useStaff()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<ImportLog[]>([])

  const [filename, setFilename] = useState('')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [ref, setRef] = useState<ImportReferenceData | null>(null)

  // reseller name (normalized) -> company id, filled in by the admin for
  // Reseller values that don't match an existing company
  const [companyResolutions, setCompanyResolutions] = useState<Record<string, string>>({})
  // service name (normalized) -> service id, filled in by the admin picking
  // an existing service or creating a new one for an unrecognized Service value
  const [serviceOverrides, setServiceOverrides] = useState<Record<string, string>>({})
  const [newServiceForm, setNewServiceForm] = useState<Record<string, { comp_id: string; sell_price: string; paid_price: string }>>({})

  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null)

  useEffect(() => {
    listImportLogs().then(setLogs).catch(() => {})
  }, [])

  function reset() {
    setStep('upload')
    setFilename('')
    setRows([])
    setRef(null)
    setCompanyResolutions({})
    setServiceOverrides({})
    setNewServiceForm({})
    setResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      const raw = await parseWorkbookFile(file)
      const parsed = normalizeRows(raw)
      const referenceData = await loadImportReferenceData()
      matchRows(parsed, referenceData)
      setFilename(file.name)
      setRows(parsed)
      setRef(referenceData)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the file')
    } finally {
      setLoading(false)
    }
  }

  if (!ref) {
    return renderUpload()
  }

  const matched = matchRows(rows, ref)
  const validRows = rows.filter((r) => r.issues.length === 0)
  const newRows = validRows.filter((r) => !r.existingSubscriberId)
  const updateRows = validRows.filter((r) => r.existingSubscriberId)
  const invalidRows = rows.filter((r) => r.issues.some((i) => i.type === 'missing_username'))
  const duplicateRows = rows.filter((r) => r.issues.some((i) => i.type === 'duplicate_username'))
  const blockedRows = rows.filter((r) => r.connectionStatus === 'suspended')

  const unresolvedCompaniesLeft = matched.unresolvedCompanies.filter(
    (name) => !companyResolutions[normalize(name)],
  )
  const unresolvedServicesLeft = matched.unresolvedServices.filter(
    (name) => !serviceOverrides[normalize(name)],
  )
  const canConfirm =
    step === 'preview' &&
    validRows.length > 0 &&
    duplicateRows.length === 0 &&
    unresolvedCompaniesLeft.length === 0 &&
    unresolvedServicesLeft.length === 0

  async function createServiceForName(serviceName: string) {
    const key = normalize(serviceName)
    const draft = newServiceForm[key]
    if (!draft || !draft.comp_id || !draft.sell_price || !draft.paid_price) {
      setError('Fill in company and both prices before creating the service.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const service = await createService({
        comp_id: draft.comp_id,
        name: serviceName,
        sell_price: Number(draft.sell_price),
        paid_price: Number(draft.paid_price),
        is_active: true,
      })
      const companyName = ref?.companies.find((c) => c.id === draft.comp_id)?.name ?? ''
      setRef((prev) =>
        prev
          ? { ...prev, services: [...prev.services, { ...service, companies: { name: companyName } }] }
          : prev,
      )
      setServiceOverrides((prev) => ({ ...prev, [key]: service.id }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create service')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!ref) return
    setLoading(true)
    setError(null)
    try {
      const companyResMap = new Map(Object.entries(companyResolutions))
      const serviceOverrideMap = new Map(Object.entries(serviceOverrides))
      const batchRows = buildBatchRows(validRows, {
        serviceByName: matched.serviceByName,
        companyByName: matched.companyByName,
        collectorByName: matched.collectorByName,
        companyResolutions: companyResMap,
        serviceOverrides: serviceOverrideMap,
      })
      const skipped = rows
        .filter((r) => r.issues.length > 0)
        .map((r) => ({
          row: r.rowIndex,
          username: r.externalUsername || '(blank)',
          reason: r.issues.map((i) => (i.type === 'missing_username' ? 'missing username' : 'duplicate username in file')).join(', '),
        }))
      const res = await importSubscribersBatch(batchRows, filename, staff?.id ?? null, rows.length, skipped)
      setResult(res)
      setStep('result')
      listImportLogs().then(setLogs).catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  function renderUpload() {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Import subscribers from Excel
        </h1>
        <div className={cardClass}>
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
            Upload the subscriber export from the ISP panel (.xlsx). This is a one-way import: new
            usernames create subscribers, existing usernames update them. Nothing is written until you
            confirm the preview.
          </p>
          {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            disabled={loading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
            className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white dark:text-neutral-300"
          />
          {loading && <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Reading file…</p>}
        </div>

        {logs.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              Recent imports
            </h2>
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className={`${cardClass} text-sm`}>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{log.filename}</p>
                  <p className="text-neutral-500 dark:text-neutral-400">
                    {new Date(log.created_at).toLocaleString()} · {log.rows_created} created ·{' '}
                    {log.rows_updated} updated · {log.rows_skipped} skipped
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (step === 'result' && result) {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Import complete
        </h1>
        <div className={`${cardClass} mb-4`}>
          <p className="text-neutral-900 dark:text-neutral-100">
            <span className="font-semibold">{result.created}</span> created ·{' '}
            <span className="font-semibold">{result.updated}</span> updated ·{' '}
            <span className="font-semibold">{result.skipped}</span> skipped
          </p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">from {filename}</p>
        </div>
        <button onClick={reset} className={primaryButtonClass}>
          Import another file
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Preview import · {filename}
      </h1>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total rows" value={rows.length} />
        <Stat label="New subscribers" value={newRows.length} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Will update" value={updateRows.length} tone="text-blue-600 dark:text-blue-400" />
        <Stat label="Invalid (no username)" value={invalidRows.length} tone="text-red-600 dark:text-red-400" />
      </div>

      {blockedRows.length > 0 && (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {blockedRows.length} row(s) have Blocked = 1. These are being imported as{' '}
          <strong>suspended</strong> (assumed temporary cut-off, not cancelled) — confirm this is
          right, or ask to change the mapping if the ISP's "Blocked" means something more permanent.
        </p>
      )}

      {duplicateRows.length > 0 && (
        <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/40 dark:text-red-200">
          {new Set(duplicateRows.map((r) => r.externalUsername)).size} username(s) appear more than
          once in this file: {Array.from(new Set(duplicateRows.map((r) => r.externalUsername))).join(', ')}.
          Fix the source file and re-upload — duplicates are not resolved automatically.
        </p>
      )}

      {matched.unresolvedCompanies.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            Unrecognized Reseller values — map to an existing company
          </h2>
          <div className="space-y-2">
            {matched.unresolvedCompanies.map((name) => (
              <div key={name} className={`${cardClass} flex items-center justify-between gap-3`}>
                <span className="text-sm text-neutral-800 dark:text-neutral-100">{name}</span>
                <select
                  value={companyResolutions[normalize(name)] ?? ''}
                  onChange={(e) =>
                    setCompanyResolutions((prev) => ({ ...prev, [normalize(name)]: e.target.value }))
                  }
                  className={`${inputClass} max-w-xs`}
                >
                  <option value="">Choose company…</option>
                  {ref.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {matched.unresolvedServices.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            Unrecognized Service values — map to an existing service or create one
          </h2>
          <div className="space-y-2">
            {matched.unresolvedServices.map((name) => {
              const key = normalize(name)
              const resolved = serviceOverrides[key]
              if (resolved) {
                return (
                  <div key={name} className={`${cardClass} text-sm text-emerald-700 dark:text-emerald-300`}>
                    "{name}" resolved.
                  </div>
                )
              }
              const draft = newServiceForm[key] ?? { comp_id: '', sell_price: '', paid_price: '' }
              return (
                <div key={name} className={cardClass}>
                  <p className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">{name}</p>
                  <div className="mb-3">
                    <label className={labelClass}>Map to existing service</label>
                    <select
                      value=""
                      onChange={(e) =>
                        setServiceOverrides((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className={inputClass}
                    >
                      <option value="">Choose service…</option>
                      {ref.services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.companies?.name})
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">— or create a new service —</p>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={draft.comp_id}
                      onChange={(e) =>
                        setNewServiceForm((prev) => ({ ...prev, [key]: { ...draft, comp_id: e.target.value } }))
                      }
                      className={inputClass}
                    >
                      <option value="">Company…</option>
                      {ref.companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Sell price"
                      value={draft.sell_price}
                      onChange={(e) =>
                        setNewServiceForm((prev) => ({ ...prev, [key]: { ...draft, sell_price: e.target.value } }))
                      }
                      className={inputClass}
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Paid price"
                      value={draft.paid_price}
                      onChange={(e) =>
                        setNewServiceForm((prev) => ({ ...prev, [key]: { ...draft, paid_price: e.target.value } }))
                      }
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => createServiceForName(name)}
                    className={`${secondaryButtonClass} mt-2`}
                  >
                    Create & use
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Sample of changes ({Math.min(15, validRows.length)} of {validRows.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                <th className="py-1 pr-3">Username</th>
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Service</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Expiry</th>
                <th className="py-1 pr-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {validRows.slice(0, 15).map((r) => (
                <tr key={r.rowIndex} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="py-1 pr-3 text-neutral-800 dark:text-neutral-100">{r.externalUsername}</td>
                  <td className="py-1 pr-3 text-neutral-800 dark:text-neutral-100">{r.name}</td>
                  <td className="py-1 pr-3 text-neutral-600 dark:text-neutral-300">{r.serviceName}</td>
                  <td className="py-1 pr-3 text-neutral-600 dark:text-neutral-300">{statusLabel[r.connectionStatus]}</td>
                  <td className="py-1 pr-3 text-neutral-600 dark:text-neutral-300">{r.expiryDate ?? '—'}</td>
                  <td className="py-1 pr-3">
                    {r.existingSubscriberId ? (
                      <span className="text-blue-600 dark:text-blue-400">update</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">new</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={reset} className={secondaryButtonClass}>
          Cancel
        </button>
        <button onClick={handleConfirm} disabled={!canConfirm || loading} className={primaryButtonClass}>
          {loading ? 'Importing…' : `Confirm import (${validRows.length} rows)`}
        </button>
      </div>
    </div>
  )
}

function normalize(name: string) {
  return name.trim().toLowerCase()
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={cardClass}>
      <p className={`text-xl font-semibold ${tone ?? 'text-neutral-900 dark:text-neutral-100'}`}>{value}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  )
}
