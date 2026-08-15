import { useEffect, useState } from 'react'
import { listSubscribersWithMissingData, updateSubscriberFields } from '../../lib/api/subscribers'
import { listAddresses } from '../../lib/api/addresses'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import type { SubscriberWithRelations } from '../../types/subscribers'
import type { Address } from '../../types/reference'
import { inputClass, labelClass, primaryButtonClass, cardClass } from '../../lib/uiClasses'

// Which fields count as "missing" for this page -- kept in sync with the
// .or(...) filter in listSubscribersWithMissingData().
const MISSING_FIELDS = ['phone', 'address_id', 'nationality', 'building'] as const
type MissingField = (typeof MISSING_FIELDS)[number]

type DraftValues = {
  phone: string
  address_id: string
  nationality: string
  building: string
}

function draftFor(sub: SubscriberWithRelations): DraftValues {
  return {
    phone: sub.phone ?? '',
    address_id: sub.address_id ?? '',
    nationality: sub.nationality ?? '',
    building: sub.building ?? '',
  }
}

function missingFieldsFor(sub: SubscriberWithRelations): MissingField[] {
  return MISSING_FIELDS.filter((f) => {
    const v = sub[f as keyof SubscriberWithRelations]
    return v === null || v === undefined || v === ''
  })
}

const FIELD_LABELS: Record<MissingField, string> = {
  phone: 'Phone',
  address_id: 'Address',
  nationality: 'Nationality',
  building: 'Building',
}

export function MissingDataPage() {
  const { staff } = useStaff()
  const [subscribers, setSubscribers] = useState<SubscriberWithRelations[]>([])
  const [addresses, setAddresses] = useState<Address[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftValues>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const [subs, addrs] = await Promise.all([listSubscribersWithMissingData(), listAddresses()])
      setSubscribers(subs)
      setAddresses(addrs)
      setDrafts(Object.fromEntries(subs.map((s) => [s.id, draftFor(s)])))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscribers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function updateDraft(id: string, patch: Partial<DraftValues>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function save(sub: SubscriberWithRelations) {
    const draft = drafts[sub.id]
    if (!draft) return
    setSavingId(sub.id)
    setError(null)
    try {
      await updateSubscriberFields(sub.id, {
        phone: draft.phone.trim() || null,
        address_id: draft.address_id || null,
        nationality: (draft.nationality || null) as SubscriberWithRelations['nationality'],
        building: draft.building.trim() || null,
      })
      logActivity(staff?.id ?? null, `${staff?.username ?? 'Someone'} filled in missing data for subscriber ${sub.name}`, 'subscriber', sub.id)
      setSubscribers((prev) => prev.filter((s) => s.id !== sub.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Subscribers with missing data
      </h1>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
        Subscribers missing a phone, address, nationality, or building — commonly sparse in
        Excel imports. Fill in what you have; a subscriber drops off this list once everything here
        is filled in.
      </p>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>}

      {!loading && subscribers.length === 0 && (
        <p className={`${cardClass} text-sm text-neutral-500 dark:text-neutral-400`}>
          Nothing missing — every subscriber has a phone, address, nationality, and building.
        </p>
      )}

      <div className="space-y-3">
        {subscribers.map((sub) => {
          const draft = drafts[sub.id] ?? draftFor(sub)
          const missing = missingFieldsFor(sub)
          return (
            <div key={sub.id} className={cardClass}>
              <div className="mb-3 flex items-center justify-between">
                <p className="font-medium text-neutral-900 dark:text-neutral-100">{sub.name}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Missing: {missing.map((f) => FIELD_LABELS[f]).join(', ')}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {missing.includes('phone') && (
                  <div>
                    <label className={labelClass}>Phone</label>
                    <input
                      type="tel"
                      value={draft.phone}
                      onChange={(e) => updateDraft(sub.id, { phone: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                )}
                {missing.includes('address_id') && (
                  <div>
                    <label className={labelClass}>Address</label>
                    <select
                      value={draft.address_id}
                      onChange={(e) => updateDraft(sub.id, { address_id: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Select an address…</option>
                      {addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {missing.includes('nationality') && (
                  <div>
                    <label className={labelClass}>Nationality</label>
                    <select
                      value={draft.nationality}
                      onChange={(e) => updateDraft(sub.id, { nationality: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Select…</option>
                      <option value="Lebanese">Lebanese</option>
                      <option value="Syrian">Syrian</option>
                    </select>
                  </div>
                )}
                {missing.includes('building') && (
                  <div>
                    <label className={labelClass}>Building</label>
                    <input
                      value={draft.building}
                      onChange={(e) => updateDraft(sub.id, { building: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                )}
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => save(sub)}
                  disabled={savingId === sub.id}
                  className={primaryButtonClass}
                >
                  {savingId === sub.id ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
