-- Reverts the Meta WhatsApp Cloud API approach from 0002 -- replaced by a
-- wa.me deep-link share button, which needs no delivery-status tracking.
ALTER TABLE invoices DROP COLUMN IF EXISTS whatsapp_sent_at;
