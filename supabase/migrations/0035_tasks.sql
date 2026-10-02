-- Tasks: field work the admin hands to technicians (a new staff role).
--
--   - staff.role gains 'technician'. A technician account can only reach
--     its own Tasks page (enforced in the app's ProtectedRoute, like the
--     collector restriction). Accounts are created/managed by the admin
--     via create_technician_login() + the existing set_staff_password().
--   - tasks: one job for one subscriber. Address/phone are copied from the
--     subscriber when the admin picks them but stored on the task, so the
--     admin can edit them for this job without touching the subscriber.
--     problem (required), possible_fixes and notes are free text from the
--     admin; report is the technician's free text back to the admin.
--     assigned_to: a technician sees tasks assigned to them plus
--     unassigned ones.
--   - status: open -> half_done (stays on the technician's list) or
--     done / cant_do (closed, goes to the admin's finished list). The admin
--     can reopen. status_changed_at / finished_at are stamped by trigger.
--   - priority: normal / high / urgent, set by the admin. An unfinished
--     task created before today (Beirut) is shown as at least 'high' --
--     computed in the app at read time, not stored, so it never needs a
--     cron job and never "sticks" after the admin lowers it again.
--   - task_product_orders: products the technician asks for, for the
--     task's subscriber. Only a request: nothing touches stock or money
--     until the admin confirms it, which runs the normal log_product_sale()
--     and links the resulting movement (status 'sold'); or rejects it.

ALTER TABLE staff DROP CONSTRAINT staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('admin', 'collector', 'technician'));

CREATE OR REPLACE FUNCTION create_technician_login(p_username TEXT, p_password TEXT)
RETURNS UUID AS $$
DECLARE
  v_staff_id UUID;
BEGIN
  INSERT INTO staff (username, password_hash, role)
  VALUES (trim(p_username), crypt(p_password, gen_salt('bf')), 'technician')
  RETURNING id INTO v_staff_id;
  RETURN v_staff_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TABLE tasks (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SET NULL, not cascade: a finished task stays in the admin's history
    -- (and metrics) even if the subscriber is later deleted.
    subscriber_id      UUID REFERENCES subscribers(id) ON DELETE SET NULL,
    subscriber_name    TEXT NOT NULL,
    address            TEXT,
    phone              TEXT,
    problem            TEXT NOT NULL CHECK (length(trim(problem)) > 0),
    possible_fixes     TEXT,
    notes              TEXT,
    priority           TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
    assigned_to        UUID REFERENCES staff(id) ON DELETE SET NULL,
    status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'half_done', 'done', 'cant_do')),
    report             TEXT,
    created_by         UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_changed_by  UUID REFERENCES staff(id) ON DELETE SET NULL,
    status_changed_at  TIMESTAMPTZ,
    finished_at        TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_subscriber_id ON tasks(subscriber_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION stamp_task_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    NEW.finished_at := CASE WHEN NEW.status IN ('done', 'cant_do') THEN now() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tasks_stamp_status BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION stamp_task_status();

CREATE TABLE task_product_orders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity      DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
    note          TEXT,
    status        TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'sold', 'rejected')),
    movement_id   UUID REFERENCES product_movements(id) ON DELETE SET NULL,
    requested_by  UUID REFERENCES staff(id) ON DELETE SET NULL,
    handled_by    UUID REFERENCES staff(id) ON DELETE SET NULL,
    handled_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_product_orders_task_id ON task_product_orders(task_id);

-- Admin confirms a technician's product request: the real sale (stock +
-- charge to the subscriber, via the existing log_product_sale) and the
-- order's status change happen in one transaction, so an order can never
-- be sold twice or left 'requested' after its sale went through.
-- p_total_amount: NULL = the normal price (lot price x quantity for
-- standard products, the lot's flat price for cable); required for a
-- bundle. p_amount_paid: cash taken now (0 = charged to the subscriber,
-- collected later through the Pay modal).
CREATE OR REPLACE FUNCTION confirm_task_product_order(
  p_order_id UUID, p_staff_id UUID, p_total_amount DECIMAL(10,2), p_amount_paid DECIMAL(10,2)
) RETURNS UUID AS $$
DECLARE
  v_order RECORD;
  v_movement_id UUID;
BEGIN
  SELECT o.id, o.product_id, o.quantity, o.note, o.status, t.subscriber_id, t.subscriber_name
    INTO v_order
    FROM task_product_orders o JOIN tasks t ON t.id = o.task_id
   WHERE o.id = p_order_id
   FOR UPDATE OF o;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status <> 'requested' THEN
    RAISE EXCEPTION 'This order was already handled';
  END IF;

  v_movement_id := log_product_sale(
    v_order.product_id, v_order.quantity, v_order.subscriber_id,
    'Task order for ' || v_order.subscriber_name || COALESCE(' -- ' || v_order.note, ''),
    p_staff_id, app_today(), p_total_amount, COALESCE(p_amount_paid, 0)
  );

  UPDATE task_product_orders
     SET status = 'sold', movement_id = v_movement_id, handled_by = p_staff_id, handled_at = now()
   WHERE id = p_order_id;
  RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql;
