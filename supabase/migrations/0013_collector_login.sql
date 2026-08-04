-- Lets the admin provision a collector's own login (username + password) at
-- the same time as creating the collector business entity. Atomic and never
-- places a placeholder/unhashed value in password_hash -- doing the insert
-- and the crypt() hashing in one statement, in Postgres, avoids the brief
-- window a client-side "insert row, then call set_staff_password" two-step
-- would otherwise leave. role is hardcoded 'collector' here (not a caller-
-- supplied argument) so this function can never be used to mint an admin
-- login by mistake.
CREATE OR REPLACE FUNCTION create_collector_login(p_collector_id UUID, p_username TEXT, p_password TEXT)
RETURNS UUID AS $$
DECLARE
  v_staff_id UUID;
BEGIN
  INSERT INTO staff (username, password_hash, role, collector_id)
  VALUES (p_username, crypt(p_password, gen_salt('bf')), 'collector', p_collector_id)
  RETURNING id INTO v_staff_id;
  RETURN v_staff_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
