-- ER-CS2 durable state for dormant, mock-only planned execution.
-- User text is not part of execution_plan; runtime_context.user_input is
-- retained only while a pending step still requires user input.

CREATE TABLE public.execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  runtime_version integer NOT NULL DEFAULT 1 CHECK (runtime_version > 0),
  handoff_version integer NOT NULL CHECK (handoff_version > 0),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  execution_plan jsonb NOT NULL CHECK (
    jsonb_typeof(execution_plan) = 'object'
    AND execution_plan ? 'steps'
    AND execution_plan ? 'orderedStepIds'
  ),
  runtime_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(runtime_context) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  failure_code text,
  snapshot_schema_version integer NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  snapshot_revision bigint NOT NULL DEFAULT 0 CHECK (snapshot_revision >= 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT execution_runs_id_user_id_key UNIQUE (id, user_id),
  CONSTRAINT execution_runs_user_idempotency_key UNIQUE (user_id, idempotency_key),
  CONSTRAINT execution_runs_idempotency_key_check CHECK (
    length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key = btrim(idempotency_key)
  ),
  CONSTRAINT execution_runs_failure_code_check CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT execution_runs_status_timestamps_check CHECK (
    (status = 'pending' AND started_at IS NULL AND completed_at IS NULL AND failure_code IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL AND failure_code IS NULL)
    OR (status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX execution_runs_user_created_idx
  ON public.execution_runs (user_id, created_at DESC);

CREATE TABLE public.execution_steps (
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_id text NOT NULL CHECK (length(step_id) BETWEEN 1 AND 128),
  capability_id text NOT NULL CHECK (capability_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  dependency_ids text[] NOT NULL DEFAULT '{}',
  attempt smallint NOT NULL DEFAULT 1 CHECK (attempt = 1),
  execution_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  result_envelope jsonb,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT execution_steps_pkey PRIMARY KEY (run_id, step_id),
  CONSTRAINT execution_steps_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_steps_failure_code_check CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT execution_steps_result_size_check CHECK (
    result_envelope IS NULL OR
    (jsonb_typeof(result_envelope) = 'object' AND octet_length(result_envelope::text) <= 65536)
  ),
  CONSTRAINT execution_steps_status_data_check CHECK (
    (status = 'pending' AND started_at IS NULL AND completed_at IS NULL AND result_envelope IS NULL AND failure_code IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL AND result_envelope IS NULL AND failure_code IS NULL)
    OR (status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND result_envelope IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND result_envelope IS NULL AND failure_code IS NOT NULL)
    OR (status = 'skipped' AND completed_at IS NOT NULL AND result_envelope IS NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX execution_steps_run_status_idx
  ON public.execution_steps (run_id, status);

-- The validated plan and its idempotency binding are immutable after creation.
CREATE OR REPLACE FUNCTION public.prevent_execution_run_plan_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.runtime_version IS DISTINCT FROM OLD.runtime_version
     OR NEW.handoff_version IS DISTINCT FROM OLD.handoff_version
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.execution_plan IS DISTINCT FROM OLD.execution_plan THEN
    RAISE EXCEPTION 'Execution plan identity is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER execution_runs_plan_immutable
  BEFORE UPDATE ON public.execution_runs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_execution_run_plan_mutation();

ALTER TABLE public.execution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.execution_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_steps FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.execution_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.execution_steps FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.execution_runs TO authenticated, service_role;
GRANT SELECT ON TABLE public.execution_steps TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.execution_runs, public.execution_steps TO service_role;
REVOKE ALL ON FUNCTION public.prevent_execution_run_plan_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY execution_runs_select_own
  ON public.execution_runs FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY execution_steps_select_own
  ON public.execution_steps FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.execution_runs AS runs
      WHERE runs.id = execution_steps.run_id
        AND runs.user_id = (SELECT auth.uid())
    )
  );

COMMENT ON TABLE public.execution_runs IS
  'Durable, user-owned planned-execution state. The objective is deliberately not persisted.';
COMMENT ON TABLE public.execution_steps IS
  'Durable planned-execution step state; results are bounded JSON envelopes or small references, never file blobs.';
