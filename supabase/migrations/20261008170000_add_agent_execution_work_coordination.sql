BEGIN;

-- CS5B.3D.1 coordination is deliberately separate from execution/authorization
-- and from owner-readable execution_runs. A claim only leases a run; it never
-- authorizes provider/tool access and its token is never exposed to clients.
CREATE TABLE public.execution_run_work_state (
  run_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  claim_id uuid,
  lease_until timestamptz,
  fencing_generation bigint NOT NULL DEFAULT 0 CHECK (fencing_generation >= 0),
  recovery_state text NOT NULL DEFAULT 'ready'
    CHECK (recovery_state IN ('ready', 'recovery_required')),
  available_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_run_work_state_claim_pair_check CHECK (
    (claim_id IS NULL AND lease_until IS NULL) OR (claim_id IS NOT NULL AND lease_until IS NOT NULL)
  ),
  CONSTRAINT execution_run_work_state_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE
);

ALTER TABLE public.execution_run_work_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_run_work_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.execution_run_work_state FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.execution_run_work_state (run_id, user_id, available_at)
SELECT run.id, run.user_id, run.created_at FROM public.execution_runs AS run;

CREATE FUNCTION public.create_execution_run_work_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.execution_run_work_state (run_id, user_id, available_at)
  VALUES (NEW.id, NEW.user_id, NEW.created_at);
  RETURN NEW;
END;
$function$;

CREATE TRIGGER execution_runs_create_work_state
  AFTER INSERT ON public.execution_runs
  FOR EACH ROW EXECUTE FUNCTION public.create_execution_run_work_state();
REVOKE ALL ON FUNCTION public.create_execution_run_work_state() FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.execution_work_claim_history (
  claim_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_id text NOT NULL,
  fencing_generation bigint NOT NULL CHECK (fencing_generation > 0),
  status text NOT NULL CHECK (status IN ('active', 'released', 'expired', 'recovery_required')),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT execution_work_claim_generation_key UNIQUE (run_id, fencing_generation),
  CONSTRAINT execution_work_claim_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_work_claim_status_check CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status <> 'active' AND ended_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.execution_run_work_state IS
  'Private service-owned lease, availability and recovery state; claims confer coordination ownership only, never execution authorization.';
COMMENT ON TABLE public.execution_work_claim_history IS
  'Durable unique claim identities and monotonically increasing fencing generations, retained across release and restart.';

ALTER TABLE public.execution_work_claim_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_work_claim_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.execution_work_claim_history FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX execution_run_work_state_due_idx
  ON public.execution_run_work_state (available_at, run_id)
  WHERE recovery_state = 'ready';

CREATE INDEX execution_steps_work_retry_due_idx
  ON public.execution_steps (next_retry_at, run_id, step_id)
  WHERE status = 'retry_pending';

CREATE INDEX execution_work_claim_history_run_idx
  ON public.execution_work_claim_history (run_id, fencing_generation DESC);

CREATE FUNCTION public.guard_agent_provider_cost_work_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_work public.execution_run_work_state%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.status <> 'admitted' OR NEW.status <> 'dispatched') THEN
    RETURN NEW;
  END IF;

  SELECT work.* INTO v_work
  FROM public.execution_run_work_state AS work
  WHERE work.run_id = NEW.run_id AND work.user_id = NEW.user_id
  FOR UPDATE;
  IF NOT FOUND OR v_work.recovery_state <> 'ready'
     OR (v_work.fencing_generation = 0 AND (v_work.claim_id IS NOT NULL OR v_work.lease_until IS NOT NULL))
     OR (v_work.fencing_generation > 0 AND (
       v_work.claim_id IS NULL OR v_work.lease_until <= pg_catalog.clock_timestamp()
       OR NOT EXISTS (
         SELECT 1 FROM public.execution_work_claim_history AS claim
         WHERE claim.claim_id = v_work.claim_id AND claim.run_id = NEW.run_id
           AND claim.user_id = NEW.user_id AND claim.fencing_generation = v_work.fencing_generation
           AND claim.status = 'active' AND claim.lease_until > pg_catalog.clock_timestamp()
       )
     )) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_WORK_CLAIM_STALE';
  END IF;
  RETURN NEW;
END;
$function$;
COMMENT ON FUNCTION public.guard_agent_provider_cost_work_claim() IS
  'Prevents new provider admissions and dispatch transitions after the run lease expires or is fenced.';

CREATE TRIGGER agent_provider_cost_admission_work_claim_guard
  BEFORE INSERT ON public.agent_provider_cost_admissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_provider_cost_work_claim();
CREATE TRIGGER agent_provider_cost_dispatch_work_claim_guard
  BEFORE UPDATE OF status ON public.agent_provider_cost_admissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_provider_cost_work_claim();
REVOKE ALL ON FUNCTION public.guard_agent_provider_cost_work_claim() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.agent_execution_work_claim_is_current(
  p_run_id uuid,
  p_user_id uuid,
  p_claim_id uuid,
  p_fencing_generation bigint
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.execution_runs AS run
    JOIN public.execution_run_work_state AS work ON work.run_id = run.id AND work.user_id = run.user_id
    WHERE run.id = p_run_id AND run.user_id = p_user_id
      AND work.recovery_state = 'ready'
      AND (
        (work.fencing_generation = 0
          AND work.claim_id IS NULL
          AND work.lease_until IS NULL
          AND p_claim_id IS NULL AND p_fencing_generation IS NULL)
        OR
        (p_claim_id IS NOT NULL AND p_fencing_generation > 0
          AND work.claim_id = p_claim_id
          AND work.fencing_generation = p_fencing_generation
          AND work.lease_until > pg_catalog.clock_timestamp()
          AND EXISTS (
            SELECT 1 FROM public.execution_work_claim_history AS claim
            WHERE claim.claim_id = p_claim_id AND claim.run_id = run.id
              AND claim.user_id = run.user_id
              AND claim.fencing_generation = p_fencing_generation
              AND claim.status = 'active'
              AND claim.lease_until > pg_catalog.clock_timestamp()
          ))
      )
  );
$function$;

CREATE FUNCTION public.discover_agent_execution_work(p_limit integer DEFAULT 50)
RETURNS TABLE(run_id uuid, step_id text, work_kind text, due_at timestamptz, fencing_generation bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_allowed_capabilities text[];
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_EXECUTION_WORK_BATCH_SIZE';
  END IF;
  SELECT policy.allowed_capabilities INTO v_allowed_capabilities
  FROM public.agent_provider_cost_active_policy AS active
  JOIN public.agent_provider_cost_policies AS policy ON policy.version = active.policy_version
  WHERE active.singleton;
  IF v_allowed_capabilities IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH eligible_run AS (
    SELECT run.*, work.claim_id AS work_claim_id, work.lease_until AS work_lease_until,
      work.fencing_generation AS work_fencing_generation, work.available_at AS work_available_at
    FROM public.execution_runs AS run
    JOIN public.execution_run_work_state AS work ON work.run_id = run.id AND work.user_id = run.user_id
    WHERE run.accepted_request_id IS NOT NULL
      AND run.status IN ('pending', 'running')
      AND run.control_state = 'active'
      AND work.recovery_state = 'ready'
      AND work.available_at <= pg_catalog.clock_timestamp()
      AND (work.claim_id IS NULL OR work.lease_until <= pg_catalog.clock_timestamp())
      AND NOT EXISTS (
        SELECT 1 FROM public.execution_run_finalizations AS receipt WHERE receipt.run_id = run.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.execution_human_approval_checkpoints AS checkpoint
        WHERE checkpoint.run_id = run.id AND checkpoint.user_id = run.user_id AND checkpoint.status <> 'approved'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.execution_steps AS blocked
        WHERE blocked.run_id = run.id AND blocked.user_id = run.user_id
          AND blocked.capability_id <> ALL (v_allowed_capabilities)
      )
  ),
  runnable AS (
    SELECT run.id AS run_id, candidate.step_id,
      CASE WHEN candidate.status = 'retry_pending' THEN 'safe_retry' ELSE 'pending_step' END AS work_kind,
      GREATEST(run.work_available_at, COALESCE(candidate.next_retry_at, run.created_at)) AS due_at,
      run.work_fencing_generation
    FROM eligible_run AS run
    JOIN LATERAL (
      SELECT step.step_id, step.status, step.next_retry_at
      FROM public.execution_steps AS step
      WHERE step.run_id = run.id AND step.user_id = run.user_id
        AND (
          step.status = 'pending'
          OR (step.status = 'retry_pending' AND step.next_retry_at <= pg_catalog.clock_timestamp())
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.unnest(step.dependency_ids) AS dependency(step_id)
          LEFT JOIN public.execution_steps AS predecessor
            ON predecessor.run_id = step.run_id AND predecessor.user_id = step.user_id
            AND predecessor.step_id = dependency.step_id
          WHERE predecessor.status IS DISTINCT FROM 'succeeded'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.agent_provider_cost_admissions AS admission
          WHERE admission.run_id = step.run_id AND admission.user_id = step.user_id
            AND admission.step_id = step.step_id
            AND admission.status <> 'released'
        )
      ORDER BY COALESCE(step.next_retry_at, run.created_at), step.step_id
      LIMIT 1
    ) AS candidate ON true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.execution_steps AS running
      WHERE running.run_id = run.id AND running.user_id = run.user_id AND running.status = 'running'
    )
  ),
  ambiguous AS (
    SELECT run.id AS run_id, COALESCE(running.step_id, admission.step_id) AS step_id,
      'recovery_required'::text AS work_kind,
      COALESCE(run.work_lease_until, run.created_at) AS due_at,
      run.work_fencing_generation
    FROM eligible_run AS run
    LEFT JOIN LATERAL (
      SELECT step.step_id FROM public.execution_steps AS step
      WHERE step.run_id = run.id AND step.user_id = run.user_id AND step.status = 'running'
      ORDER BY step.step_id LIMIT 1
    ) AS running ON true
    LEFT JOIN LATERAL (
      SELECT cost.step_id FROM public.agent_provider_cost_admissions AS cost
      WHERE cost.run_id = run.id AND cost.user_id = run.user_id
        AND cost.status <> 'released'
        AND EXISTS (
          SELECT 1 FROM public.execution_steps AS step
          WHERE step.run_id = cost.run_id AND step.user_id = cost.user_id
            AND step.step_id = cost.step_id AND step.status <> 'succeeded'
        )
      ORDER BY cost.created_at, cost.step_id LIMIT 1
    ) AS admission ON true
    WHERE (run.work_claim_id IS NULL OR run.work_lease_until <= pg_catalog.clock_timestamp())
      AND (running.step_id IS NOT NULL OR admission.step_id IS NOT NULL)
  )
  SELECT discovered.run_id, discovered.step_id, discovered.work_kind,
    discovered.due_at, discovered.work_fencing_generation
  FROM (
    SELECT * FROM runnable
    UNION ALL
    SELECT * FROM ambiguous
  ) AS discovered
  ORDER BY discovered.due_at, discovered.run_id, discovered.step_id
  LIMIT p_limit;
END;
$function$;

CREATE FUNCTION public.claim_agent_execution_work(
  p_run_id uuid,
  p_claim_id uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.execution_runs%ROWTYPE;
  v_work public.execution_run_work_state%ROWTYPE;
  v_step_id text;
  v_generation bigint;
  v_lease_until timestamptz;
  v_allowed_capabilities text[];
  v_now timestamptz;
BEGIN
  IF p_run_id IS NULL OR p_claim_id IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_EXECUTION_WORK_CLAIM';
  END IF;

  SELECT run.* INTO v_run FROM public.execution_runs AS run
  WHERE run.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;
  SELECT work.* INTO v_work FROM public.execution_run_work_state AS work
  WHERE work.run_id = v_run.id AND work.user_id = v_run.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'ineligible'); END IF;
  v_now := pg_catalog.clock_timestamp();

  IF v_work.claim_id = p_claim_id THEN
    IF v_work.lease_until > v_now AND EXISTS (
      SELECT 1 FROM public.execution_work_claim_history AS claim
      WHERE claim.claim_id = p_claim_id AND claim.status = 'active'
        AND claim.fencing_generation = v_work.fencing_generation
    ) THEN
      SELECT claim.step_id INTO v_step_id FROM public.execution_work_claim_history AS claim
      WHERE claim.claim_id = p_claim_id;
      RETURN pg_catalog.jsonb_build_object('status', 'claimed', 'claimId', p_claim_id,
        'fencingGeneration', v_work.fencing_generation, 'runId', v_run.id,
        'stepId', v_step_id, 'snapshotRevision', v_run.snapshot_revision,
        'leaseExpiresAt', v_work.lease_until, 'replayed', true);
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'stale_claim');
  END IF;

  IF EXISTS (SELECT 1 FROM public.execution_work_claim_history AS claim WHERE claim.claim_id = p_claim_id) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'stale_claim');
  END IF;
  IF v_work.claim_id IS NOT NULL AND v_work.lease_until > v_now THEN
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  IF v_run.accepted_request_id IS NULL OR v_run.status NOT IN ('pending', 'running')
     OR v_run.control_state <> 'active' OR v_work.recovery_state <> 'ready'
     OR v_work.available_at > v_now
     OR EXISTS (
       SELECT 1 FROM public.execution_run_finalizations AS receipt WHERE receipt.run_id = v_run.id
     ) OR EXISTS (
       SELECT 1 FROM public.execution_human_approval_checkpoints AS checkpoint
       WHERE checkpoint.run_id = v_run.id AND checkpoint.user_id = v_run.user_id AND checkpoint.status <> 'approved'
     ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'ineligible');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.execution_steps AS step
    WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id AND step.status = 'running'
  ) OR EXISTS (
    SELECT 1 FROM public.agent_provider_cost_admissions AS admission
    JOIN public.execution_steps AS step ON step.run_id = admission.run_id
      AND step.user_id = admission.user_id AND step.step_id = admission.step_id
    WHERE admission.run_id = v_run.id AND admission.user_id = v_run.user_id
      AND admission.status <> 'released' AND step.status <> 'succeeded'
  ) THEN
    IF v_work.claim_id IS NOT NULL THEN
      UPDATE public.execution_work_claim_history SET status = 'recovery_required', ended_at = v_now
      WHERE claim_id = v_work.claim_id AND status = 'active';
    END IF;
    UPDATE public.execution_run_work_state SET claim_id = NULL,
      lease_until = NULL, recovery_state = 'recovery_required'
    WHERE run_id = v_run.id;
    RETURN pg_catalog.jsonb_build_object('status', 'recovery_required');
  END IF;

  SELECT policy.allowed_capabilities INTO v_allowed_capabilities
  FROM public.agent_provider_cost_active_policy AS active
  JOIN public.agent_provider_cost_policies AS policy ON policy.version = active.policy_version
  WHERE active.singleton;
  IF v_allowed_capabilities IS NULL OR EXISTS (
    SELECT 1 FROM public.execution_steps AS step
    WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
      AND step.capability_id <> ALL (v_allowed_capabilities)
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'ineligible');
  END IF;

  SELECT step.step_id INTO v_step_id
  FROM public.execution_steps AS step
  WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
    AND (step.status = 'pending' OR (step.status = 'retry_pending' AND step.next_retry_at <= v_now))
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.unnest(step.dependency_ids) AS dependency(step_id)
      LEFT JOIN public.execution_steps AS predecessor
        ON predecessor.run_id = step.run_id AND predecessor.user_id = step.user_id
        AND predecessor.step_id = dependency.step_id
      WHERE predecessor.status IS DISTINCT FROM 'succeeded'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_provider_cost_admissions AS admission
      WHERE admission.run_id = step.run_id AND admission.user_id = step.user_id
        AND admission.step_id = step.step_id AND admission.status <> 'released'
    )
  ORDER BY COALESCE(step.next_retry_at, v_run.created_at), step.step_id
  LIMIT 1;
  IF v_step_id IS NULL THEN RETURN pg_catalog.jsonb_build_object('status', 'ineligible'); END IF;

  v_generation := v_work.fencing_generation + 1;
  v_lease_until := v_now + pg_catalog.make_interval(secs => p_lease_seconds);
  IF v_work.claim_id IS NOT NULL THEN
    UPDATE public.execution_work_claim_history SET status = 'expired', ended_at = v_now
    WHERE claim_id = v_work.claim_id AND status = 'active';
  END IF;
  INSERT INTO public.execution_work_claim_history (
    claim_id, run_id, user_id, step_id, fencing_generation, status, claimed_at, lease_until
  ) VALUES (p_claim_id, v_run.id, v_run.user_id, v_step_id, v_generation, 'active', v_now, v_lease_until);
  UPDATE public.execution_run_work_state SET claim_id = p_claim_id,
    lease_until = v_lease_until, fencing_generation = v_generation
  WHERE run_id = v_run.id;
  RETURN pg_catalog.jsonb_build_object('status', 'claimed', 'claimId', p_claim_id,
    'fencingGeneration', v_generation, 'runId', v_run.id, 'stepId', v_step_id,
    'snapshotRevision', v_run.snapshot_revision, 'leaseExpiresAt', v_lease_until, 'replayed', false);
END;
$function$;

CREATE FUNCTION public.renew_agent_execution_work_claim(
  p_run_id uuid,
  p_claim_id uuid,
  p_fencing_generation bigint,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.execution_runs%ROWTYPE;
  v_work public.execution_run_work_state%ROWTYPE;
  v_now timestamptz;
  v_lease_until timestamptz;
BEGIN
  IF p_run_id IS NULL OR p_claim_id IS NULL OR p_fencing_generation IS NULL
     OR p_fencing_generation < 1 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_EXECUTION_WORK_CLAIM';
  END IF;
  SELECT run.* INTO v_run FROM public.execution_runs AS run
  WHERE run.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;
  SELECT work.* INTO v_work FROM public.execution_run_work_state AS work
  WHERE work.run_id = v_run.id AND work.user_id = v_run.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;
  v_now := pg_catalog.clock_timestamp();
  IF NOT public.agent_execution_work_claim_is_current(v_run.id, v_run.user_id, p_claim_id, p_fencing_generation)
     OR v_work.claim_id <> p_claim_id THEN
    RETURN pg_catalog.jsonb_build_object('status', 'stale_claim');
  END IF;
  IF v_run.status NOT IN ('pending', 'running') OR v_run.control_state <> 'active'
     OR EXISTS (
       SELECT 1 FROM public.execution_human_approval_checkpoints AS checkpoint
       WHERE checkpoint.run_id = v_run.id AND checkpoint.user_id = v_run.user_id AND checkpoint.status <> 'approved'
     ) OR EXISTS (
       SELECT 1 FROM public.execution_run_finalizations AS receipt WHERE receipt.run_id = v_run.id
     ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'ineligible');
  END IF;
  v_lease_until := v_now + pg_catalog.make_interval(secs => p_lease_seconds);
  UPDATE public.execution_run_work_state SET lease_until = v_lease_until WHERE run_id = v_run.id;
  UPDATE public.execution_work_claim_history SET lease_until = v_lease_until
  WHERE claim_id = p_claim_id AND fencing_generation = p_fencing_generation AND status = 'active';
  RETURN pg_catalog.jsonb_build_object('status', 'renewed', 'leaseExpiresAt', v_lease_until);
END;
$function$;

CREATE FUNCTION public.release_agent_execution_work_claim(
  p_run_id uuid,
  p_claim_id uuid,
  p_fencing_generation bigint,
  p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.execution_runs%ROWTYPE;
  v_work public.execution_run_work_state%ROWTYPE;
BEGIN
  IF p_run_id IS NULL OR p_claim_id IS NULL OR p_fencing_generation IS NULL
     OR p_fencing_generation < 1 OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_EXECUTION_WORK_CLAIM';
  END IF;
  SELECT run.* INTO v_run FROM public.execution_runs AS run
  WHERE run.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;
  SELECT work.* INTO v_work FROM public.execution_run_work_state AS work
  WHERE work.run_id = v_run.id AND work.user_id = v_run.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;
  IF NOT public.agent_execution_work_claim_is_current(v_run.id, v_run.user_id, p_claim_id, p_fencing_generation)
     OR v_work.claim_id <> p_claim_id THEN
    RETURN pg_catalog.jsonb_build_object('status', 'stale_claim');
  END IF;
  IF v_run.snapshot_revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('status', 'revision_conflict');
  END IF;
  IF v_run.status NOT IN ('pending', 'running', 'succeeded', 'failed')
     OR EXISTS (
       SELECT 1 FROM public.execution_steps AS step
       WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id AND step.status = 'running'
     ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unsafe_boundary');
  END IF;
  UPDATE public.execution_work_claim_history SET status = 'released', ended_at = pg_catalog.clock_timestamp()
  WHERE claim_id = p_claim_id AND fencing_generation = p_fencing_generation AND status = 'active';
  UPDATE public.execution_run_work_state SET claim_id = NULL, lease_until = NULL,
    available_at = pg_catalog.clock_timestamp()
  WHERE run_id = v_run.id;
  RETURN pg_catalog.jsonb_build_object('status', 'released');
END;
$function$;

CREATE FUNCTION public.list_orphaned_agent_request_acceptances(p_limit integer DEFAULT 100)
RETURNS TABLE(request_id uuid, created_at timestamptz, classification text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_ORPHAN_BATCH_SIZE';
  END IF;
  RETURN QUERY
  SELECT acceptance.request_id, acceptance.created_at, 'association_recovery_blocked'::text
  FROM public.agent_request_acceptances AS acceptance
  LEFT JOIN public.execution_runs AS run
    ON run.accepted_request_id = acceptance.request_id AND run.user_id = acceptance.user_id
  WHERE run.id IS NULL
  ORDER BY acceptance.created_at, acceptance.request_id
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.agent_execution_work_claim_is_current(uuid, uuid, uuid, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_agent_execution_work(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_agent_execution_work(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_agent_execution_work_claim(uuid, uuid, bigint, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_agent_execution_work_claim(uuid, uuid, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_orphaned_agent_request_acceptances(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_execution_work_claim_is_current(uuid, uuid, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_agent_execution_work(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_agent_execution_work(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_agent_execution_work_claim(uuid, uuid, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_agent_execution_work_claim(uuid, uuid, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_orphaned_agent_request_acceptances(integer) TO service_role;

COMMENT ON FUNCTION public.discover_agent_execution_work(integer) IS
  'Bounded content-free discovery only; reports safe due work and ambiguous recovery-required work without claiming or dispatching.';
COMMENT ON FUNCTION public.claim_agent_execution_work(uuid, uuid, integer) IS
  'Atomically claims one accepted run using database time and a monotonic fence; claim grants coordination ownership only, not execution authorization.';
COMMENT ON FUNCTION public.list_orphaned_agent_request_acceptances(integer) IS
  'Reports accepted requests lacking an associated durable run; does not reconstruct input, replan, associate, or reserve usage.';

COMMIT;
