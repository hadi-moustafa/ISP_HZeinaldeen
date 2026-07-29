// Sends a WhatsApp message via the Meta Cloud API using a pre-approved
// message template. Business-initiated messages (which invoice notices are)
// can only be sent as templates -- free-form text only works inside a 24h
// window after the customer messages first. Create + get the template
// approved in Meta Business Manager before this will actually deliver.
//
// Required secrets (set via `supabase secrets set`):
//   WHATSAPP_ACCESS_TOKEN     - permanent/long-lived token for the app
//   WHATSAPP_PHONE_NUMBER_ID  - the sending number's phone_number_id
//   WHATSAPP_TEMPLATE_NAME    - approved template name (default: invoice_notice)
//   WHATSAPP_TEMPLATE_LANG    - template language code (default: en)

export interface InvoiceWhatsAppVars {
  subscriberName: string
  amountDue: string
  dueDate: string
}

// Meta's Graph API wants digits only (country code + number, no leading +,
// no spaces/dashes). This is a light normalization, not full E.164
// validation -- phone numbers must already include the country code.
export function normalizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/[^\d]/g, '')
}

export async function sendInvoiceWhatsAppMessage(
  phone: string,
  vars: InvoiceWhatsAppVars,
): Promise<{ ok: boolean; error?: string }> {
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const templateName = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'invoice_notice'
  const templateLang = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'en'

  if (!accessToken || !phoneNumberId) {
    return { ok: false, error: 'WhatsApp credentials not configured' }
  }

  const to = normalizePhoneForWhatsApp(phone)
  if (!to) {
    return { ok: false, error: 'Subscriber has no usable phone number' }
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: vars.subscriberName },
              { type: 'text', text: vars.amountDue },
              { type: 'text', text: vars.dueDate },
            ],
          },
        ],
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, error: `WhatsApp send failed (${res.status}): ${body}` }
  }

  return { ok: true }
}
