-- The new combined Pay modal can settle Service/Debt/Products in one
-- Save -- rather than opening 3 separate wa.me tabs back-to-back (wa.me
-- can't queue multiple sends), "Save & Notify" now sends one combined
-- summary message. Kept admin-editable via the WhatsApp Messages page
-- like the other four templates (0021_message_templates.sql).
INSERT INTO message_templates (key, label, placeholders, template) VALUES
(
    'payment_summary',
    'Combined payment summary',
    '{{name}}, {{lines}}, {{date}}, {{time}}',
    E'عزيزي/عزيزتي {{name}}،\nنؤكد استلام دفعتك بتاريخ {{date}} الساعة {{time}}:\n{{lines}}\nشكراً لتعاملكم معنا.'
);
