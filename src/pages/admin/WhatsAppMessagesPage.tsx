import { useEffect, useState } from 'react'
import { listMessageTemplates, updateMessageTemplate } from '../../lib/api/messageTemplates'
import { logActivity } from '../../lib/api/activityLog'
import { useStaff } from '../../context/StaffContext'
import { renderTemplate, DEFAULT_TEMPLATES } from '../../lib/whatsapp'
import type { MessageTemplate, MessageTemplateKey } from '../../types/messageTemplates'
import { cardClass, primaryButtonClass, secondaryButtonClass } from '../../lib/uiClasses'

// Sample values for the live preview -- keyed the same way as each
// template's real placeholders, just filled with representative data so an
// admin can see roughly what a subscriber will receive.
const PREVIEW_VARS: Record<string, string> = {
  name: 'Ahmad',
  date: '15 آب 2026',
  time: '02:30 م',
  due_date: '20 آب 2026',
  amount: '50',
  period: '2026-08',
  receipt_url: 'https://isp-h-zeinaldeen.vercel.app/receipt/…',
}

export function WhatsAppMessagesPage() {
  const { staff } = useStaff()
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  function refresh() {
    setLoading(true)
    setError(null)
    listMessageTemplates()
      .then((rows) => {
        setTemplates(rows)
        setDrafts(Object.fromEntries(rows.map((r) => [r.key, r.template])))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load templates'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  async function handleSave(t: MessageTemplate) {
    const draft = drafts[t.key] ?? t.template
    setSavingKey(t.key)
    setError(null)
    try {
      await updateMessageTemplate(t.key as MessageTemplateKey, draft)
      logActivity(
        staff?.id ?? null,
        `${staff?.username ?? 'Someone'} updated the "${t.label}" WhatsApp message template`,
        'message_template',
        t.key,
      )
      setSavedKey(t.key)
      setTimeout(() => setSavedKey((k) => (k === t.key ? null : k)), 2000)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    } finally {
      setSavingKey(null)
    }
  }

  function handleReset(t: MessageTemplate) {
    setDrafts((d) => ({ ...d, [t.key]: DEFAULT_TEMPLATES[t.key as MessageTemplateKey] ?? t.template }))
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">WhatsApp message write</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Customize the wording sent via WhatsApp for each case. Use the placeholders shown under each
        message -- they're filled in automatically when the message is sent.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="text-neutral-500">Loading…</p>}

      <div className="space-y-4">
        {templates.map((t) => {
          const draft = drafts[t.key] ?? t.template
          const dirty = draft !== t.template
          return (
            <div key={t.key} className={cardClass}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold text-neutral-900">{t.label}</p>
                {savedKey === t.key && <span className="text-xs font-medium text-emerald-600">Saved</span>}
              </div>

              <textarea
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.key]: e.target.value }))}
                aria-label={`${t.label} message`}
                rows={4}
                dir="auto"
                className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
              />

              <p className="mb-3 text-xs text-neutral-400">Placeholders: {t.placeholders}</p>

              <div className="mb-3 rounded-lg bg-neutral-50 px-3 py-2">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">Preview</p>
                <p className="whitespace-pre-wrap text-sm text-neutral-700" dir="auto">
                  {renderTemplate(draft, PREVIEW_VARS)}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => handleReset(t)} className={secondaryButtonClass}>
                  Reset to default
                </button>
                <button
                  onClick={() => handleSave(t)}
                  disabled={!dirty || savingKey === t.key}
                  className={primaryButtonClass}
                >
                  {savingKey === t.key ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )
        })}
        {!loading && templates.length === 0 && <p className="text-neutral-500">No templates found.</p>}
      </div>
    </div>
  )
}
