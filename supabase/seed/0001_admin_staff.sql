-- One-time seed: creates the initial admin login.
-- Run manually in the Supabase SQL Editor (not part of the migration chain,
-- since it's environment-specific data, not schema).
INSERT INTO staff (username, password_hash, role)
VALUES ('hznet', crypt('0000', gen_salt('bf')), 'admin')
ON CONFLICT (username) DO NOTHING;
