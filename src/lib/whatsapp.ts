import { useEffect, useState } from 'react'
import { listMessageTemplates } from './api/messageTemplates'
import type { MessageTemplate, MessageTemplateKey } from '../types/messageTemplates'

// Opens WhatsApp with a chat pre-filled to the given phone number and
// message -- the staff member still has to tap send themselves. Zero
// infrastructure, no Cloud API/access tokens. See CLAUDE.md's "Receipt
// delivery" note for why this replaced an earlier Cloud API plan.
export function openWhatsApp(phone: string | null | undefined, message: string): boolean {
  if (!phone) return false
  const digits = phone.replace(/[^\d]/g, '')
  if (!digits) return false
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

function formatArabicDateTime(d: Date) {
  const date = d.toLocaleDateString('ar-LB', { year: 'numeric', month: 'long', day: 'numeric' })
  const time = d.toLocaleTimeString('ar-LB', { hour: '2-digit', minute: '2-digit' })
  return { date, time }
}

function formatArabicDate(isoDate: string) {
  // isoDate is a DATE-only string (YYYY-MM-DD); parse as UTC to avoid the
  // local-midnight/toISOString timezone shift documented elsewhere in this
  // codebase for date-only values.
  const d = new Date(`${isoDate}T00:00:00Z`)
  return d.toLocaleDateString('ar-LB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

// Defaults mirror the seed rows in 0021_message_templates.sql -- used as a
// fallback before the DB-editable templates have loaded (or if a row is
// ever missing), so a subscriber never gets a blank message.
export const DEFAULT_TEMPLATES: Record<MessageTemplateKey, string> = {
  paid: 'عزيزي/عزيزتي {{name}}،\nنؤكد استلام دفعة اشتراكك لهذا الشهر بتاريخ {{date}} الساعة {{time}}.\nشكراً لتعاملكم معنا.',
  postponed: 'عزيزي/عزيزتي {{name}}،\nتم تأجيل موعد دفع اشتراكك إلى تاريخ {{due_date}}.\nيرجى تسديد المبلغ المستحق في هذا التاريخ.',
  debt: 'عزيزي/عزيزتي {{name}}،\nنود إعلامكم أن اشتراككم لا يزال غير مسدد. في حال استمرار التأخير، سيصبح المبلغ المستحق للشهر القادم {{amount}} (ضعف القيمة الاعتيادية).\nيرجى المبادرة بالتسديد في أقرب وقت ممكن.',
  receipt: "Hi {{name}}, here's your receipt for {{period}}: {{receipt_url}}",
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match)
}

export function paidMessage(subscriberName: string, template: string = DEFAULT_TEMPLATES.paid) {
  const { date, time } = formatArabicDateTime(new Date())
  return renderTemplate(template, { name: subscriberName, date, time })
}

export function postponedMessage(
  subscriberName: string,
  newDueDate: string,
  template: string = DEFAULT_TEMPLATES.postponed,
) {
  return renderTemplate(template, { name: subscriberName, due_date: formatArabicDate(newDueDate) })
}

export function debtMessage(
  subscriberName: string,
  nextMonthAmount: number,
  template: string = DEFAULT_TEMPLATES.debt,
) {
  return renderTemplate(template, { name: subscriberName, amount: String(nextMonthAmount) })
}

export function receiptMessage(
  subscriberName: string,
  periodMonth: string,
  receiptUrl: string,
  template: string = DEFAULT_TEMPLATES.receipt,
) {
  return renderTemplate(template, { name: subscriberName, period: periodMonth, receipt_url: receiptUrl })
}

// Loads the admin-editable templates once per mount and exposes them keyed
// by their `key` column, falling back to DEFAULT_TEMPLATES for any row
// that hasn't loaded yet (or is missing) so a caller never has to null-
// check before building a message.
export function useMessageTemplates(): Record<MessageTemplateKey, string> {
  const [templates, setTemplates] = useState<Record<MessageTemplateKey, string>>(DEFAULT_TEMPLATES)

  useEffect(() => {
    let cancelled = false
    listMessageTemplates()
      .then((rows: MessageTemplate[]) => {
        if (cancelled) return
        setTemplates((prev) => {
          const next = { ...prev }
          for (const row of rows) next[row.key] = row.template
          return next
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return templates
}
