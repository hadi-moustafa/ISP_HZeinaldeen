export type MessageTemplateKey = 'paid' | 'postponed' | 'debt' | 'receipt'

export interface MessageTemplate {
  key: MessageTemplateKey
  label: string
  placeholders: string
  template: string
  updated_at: string
}
