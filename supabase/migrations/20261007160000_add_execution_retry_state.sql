-- ER-CS4A.1: durable retry scheduling and atomic retry claims.
-- Existing rows keep attempt=1 and a null retry time; no data rewrite is needed.

ALTER TABLE public.execution_steps
  ADD COLUMN next_retry_at timestamp with time zone;

ALTER TABLE public.execution_steps
  DROP CONSTRAINT execution_steps_attempt_check,
  DROP CONSTRAINT execution_steps_status_check,
  DROP CONSTRAINT execution_steps_status_data_check;

ALTER TABLE public.execution_steps
  ADD CONSTRAINT execution_steps_attempt_check
    CHECK (attempt BETWEEN 1 AND 3),
  ADD CONSTRAINT execution_steps_status_check
    CHECK (status IN ('pending', 'running', 'retry_pending', 'succeeded', 'failed', 'skipped')),
  ADD CONSTRAINT execution_steps_status_data_check CHECK (
    (status = 'pending' AND attempt = 1 AND started_at IS NULL AND completed_at IS NULL
      AND result_envelope IS NULL AND result_payload_id IS NULL AND failure_code IS NULL AND next_retry_at IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL
      AND result_envelope IS NULL AND result_payload_id IS NULL AND failure_code IS NULL AND next_retry_at IS NULL)
    OR (status = 'retry_pending' AND started_at IS NOT NULL AND completed_at IS NULL
      AND result_envelope IS NULL AND result_payload_id IS NULL AND failure_code IS NULL AND next_retry_at IS NOT NULL)
    OR (status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND result_envelope IS NOT NULL AND failure_code IS NULL AND next_retry_at IS NULL)
    OR (status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND result_envelope IS NULL AND result_payload_id IS NULL AND failure_code IS NOT NULL AND next_retry_at IS NULL)
    OR (status = 'skipped' AND completed_at IS NOT NULL
      AND result_envelope IS NULL AND result_payload_id IS NULL AND failure_code IS NOT NULL AND next_retry_at IS NULL)
  );

COMMENT ON COLUMN public.execution_steps.next_retry_at IS
  'Earliest database-time eligibility for an explicitly scheduled retry; only present while status is retry_pending.';
