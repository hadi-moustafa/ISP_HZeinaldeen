-- Tasks: an 'in_progress' status between 'open' and done.
--
-- A technician accepts a task before working on it (open -> in_progress),
-- so the admin can see which jobs have actually been picked up. Accepting
-- an unassigned ("any technician") task also assigns it to whoever
-- accepted it -- done by the app in the same update, so two technicians
-- don't both take the same job.
--
-- Additive only: the existing statuses and stamp_task_status() trigger are
-- unchanged (status_changed_at is stamped on accept like any other status
-- change; finished_at stays NULL since in_progress isn't finished).

ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('open', 'in_progress', 'half_done', 'done', 'cant_do'));
