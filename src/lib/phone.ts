// Same rules as normalize_phone() in 0032_import_protections.sql, which a
// DB trigger applies to every subscriber phone on save -- this copy exists
// so the import preview can tell whether a phone would actually change.
// Lebanese numbers get +961 (03123456 / 3123456 / 71123456); 00-prefixed
// and already-international numbers keep their country code; fewer than
// 7 digits isn't a phone number.
export function normalizePhone(phone: string | null | undefined): string | null {
  let digits = (phone ?? '').replace(/[^\d]/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length < 7) return null
  if (digits.length === 8 && digits.startsWith('0')) return `+961${digits.slice(1)}`
  if (digits.length === 7 || digits.length === 8) return `+961${digits}`
  return `+${digits}`
}
