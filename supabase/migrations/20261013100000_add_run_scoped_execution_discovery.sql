BEGIN;

-- Run-bound wakes use this service-only discovery entry point. Its required
-- run ID is applied inside the eligibility query, so empty results never
-- widen to another accepted workflow.
CREATE FUNCTION public.discover_agent_execution_work_for_run(
  p_run_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(run_id uuid, step_id text, work_kind text, due_at timestamptz, fencing_generation bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_allowed_capabilities text[];
BEGIN
  IF p_run_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_EXECUTION_RUN_DISCOVERY';
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
    WHERE run.id = p_run_id
      AND run.accepted_request_id IS NOT NULL
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
            AND admission.step_id = step.step_id AND admission.status <> 'released'
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

REVOKE ALL ON FUNCTION public.discover_agent_execution_work_for_run(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discover_agent_execution_work_for_run(uuid, integer)
  TO service_role;
COMMENT ON FUNCTION public.discover_agent_execution_work_for_run(uuid, integer) IS
  'Bounded content-free discovery for one exact accepted run; never claims, dispatches, or returns another run.';

COMMIT;
