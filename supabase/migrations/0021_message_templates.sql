-- Editable WhatsApp message templates -- lets an admin customize the
-- wording sent for each automated WhatsApp case (paid confirmation,
-- postponement, debt warning, receipt share) without a code change.
-- `template` holds {{placeholder}} tokens substituted client-side (see
-- renderTemplate() in src/lib/whatsapp.ts); `placeholders` documents which
-- tokens are valid for that key, shown to the admin as a legend on the
-- editor page.
CREATE TABLE message_templates (
    key            TEXT PRIMARY KEY,
    label          TEXT NOT NULL,
    placeholders   TEXT NOT NULL,
    template       TEXT NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_message_templates_updated_at
    BEFORE UPDATE ON message_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO message_templates (key, label, placeholders, template) VALUES
(
    'paid',
    'Payment confirmation',
    '{{name}}, {{date}}, {{time}}',
    E'عزيزي/عزيزتي {{name}}،\nنؤكد استلام دفعة اشتراكك لهذا الشهر بتاريخ {{date}} الساعة {{time}}.\nشكراً لتعاملكم معنا.'
),
(
    'postponed',
    'Payment postponed',
    '{{name}}, {{due_date}}',
    E'عزيزي/عزيزتي {{name}}،\nتم تأجيل موعد دفع اشتراكك إلى تاريخ {{due_date}}.\nيرجى تسديد المبلغ المستحق في هذا التاريخ.'
),
(
    'debt',
    'Debt warning',
    '{{name}}, {{amount}}',
    E'عزيزي/عزيزتي {{name}}،\nنود إعلامكم أن اشتراككم لا يزال غير مسدد. في حال استمرار التأخير، سيصبح المبلغ المستحق للشهر القادم {{amount}} (ضعف القيمة الاعتيادية).\nيرجى المبادرة بالتسديد في أقرب وقت ممكن.'
),
(
    'receipt',
    'Receipt share',
    '{{name}}, {{period}}, {{receipt_url}}',
    E'Hi {{name}}, here''s your receipt for {{period}}: {{receipt_url}}'
);
