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

export function paidMessage(subscriberName: string) {
  const { date, time } = formatArabicDateTime(new Date())
  return `عزيزي/عزيزتي ${subscriberName}،\nنؤكد استلام دفعة اشتراكك لهذا الشهر بتاريخ ${date} الساعة ${time}.\nشكراً لتعاملكم معنا.`
}

export function postponedMessage(subscriberName: string, newDueDate: string) {
  return `عزيزي/عزيزتي ${subscriberName}،\nتم تأجيل موعد دفع اشتراكك إلى تاريخ ${formatArabicDate(newDueDate)}.\nيرجى تسديد المبلغ المستحق في هذا التاريخ.`
}

export function debtMessage(subscriberName: string, nextMonthAmount: number) {
  return `عزيزي/عزيزتي ${subscriberName}،\nنود إعلامكم أن اشتراككم لا يزال غير مسدد. في حال استمرار التأخير، سيصبح المبلغ المستحق للشهر القادم ${nextMonthAmount} (ضعف القيمة الاعتيادية).\nيرجى المبادرة بالتسديد في أقرب وقت ممكن.`
}
