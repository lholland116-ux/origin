BEGIN;

-- A pre-dispatch repair is a state transition, not permission to call a provider.
-- The unique event makes a repeated operator request observable and idempotent.
CREATE TABLE public.execution_predispatch_recovery_events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_id text NOT NULL,
  execution_key uuid NOT NULL,
  expired_claim_id uuid NOT NULL,
  prior_fencing_generation bigint NOT NULL CHECK (prior_fencing_generation > 0),
  fencing_generation bigint NOT NULL CHECK (fencing_generation = prior_fencing_generation + 1),
  prior_snapshot_revision bigint NOT NULL CHECK (prior_snapshot_revision >= 0),
  prior_snapshot_sha256 text NOT NULL CHECK (prior_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision = prior_snapshot_revision + 1),
  control_revision bigint NOT NULL CHECK (control_revision > 0),
  action text NOT NULL DEFAULT 'standard_predispatch_paused'
    CHECK (action = 'standard_predispatch_paused'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT execution_predispatch_recovery_events_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_predispatch_recovery_events_unique UNIQUE (run_id, step_id, execution_key)
);

ALTER TABLE public.execution_predispatch_recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_predispatch_recovery_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.execution_predispatch_recovery_events FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER execution_predispatch_recovery_events_immutable
  BEFORE UPDATE ON public.execution_predispatch_recovery_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_execution_control_event_mutation();
-- The append-only event follows the account-deletion semantics of existing
-- execution audit tables. Direct runtime roles have no DELETE grant, while
-- the cascading foreign key can still remove rows with a deleted run.

CREATE FUNCTION public.recover_trusted_predispatch_standard_step(
  p_run_id uuid,
  p_expected_snapshot_revision bigint,
  p_expected_snapshot_sha256 text,
  p_expected_claim_id uuid,
  p_expected_fencing_generation bigint,
  p_expected_execution_key uuid
)
RETURNS TABLE (status text, snapshot_revision bigint, control_revision bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.execution_runs%ROWTYPE;
  v_work public.execution_run_work_state%ROWTYPE;
  v_step public.execution_steps%ROWTYPE;
  v_claim public.execution_work_claim_history%ROWTYPE;
  v_acceptance public.agent_request_acceptances%ROWTYPE;
  v_event public.execution_predispatch_recovery_events%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_snapshot jsonb;
  v_snapshot_sha256 text;
BEGIN
  IF p_run_id IS NULL OR p_expected_snapshot_revision IS NULL OR p_expected_snapshot_revision < 0
     OR p_expected_snapshot_sha256 IS NULL OR p_expected_snapshot_sha256 !~ '^[0-9a-f]{64}$'
     OR p_expected_claim_id IS NULL OR p_expected_fencing_generation IS NULL
     OR p_expected_fencing_generation < 1 OR p_expected_fencing_generation = 9223372036854775807
     OR p_expected_execution_key IS NULL THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  -- The run lock serializes with claims, human controls, admissions, and checkpoints.
  SELECT run.* INTO v_run FROM public.execution_runs AS run
  WHERE run.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  v_snapshot_sha256 := pg_catalog.encode(extensions.digest(v_run.snapshot::text, 'sha256'), 'hex');
  SELECT work.* INTO v_work FROM public.execution_run_work_state AS work
  WHERE work.run_id = v_run.id AND work.user_id = v_run.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  SELECT step.* INTO v_step FROM public.execution_steps AS step
  WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
    AND step.step_id = v_run.execution_plan->'orderedStepIds'->>1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT event.* INTO v_event FROM public.execution_predispatch_recovery_events AS event
  WHERE event.run_id = v_run.id AND event.step_id = v_step.step_id
    AND event.execution_key = p_expected_execution_key;
  IF FOUND THEN
    IF v_event.expired_claim_id = p_expected_claim_id
       AND v_event.prior_fencing_generation = p_expected_fencing_generation
       AND v_event.prior_snapshot_revision = p_expected_snapshot_revision
       AND v_event.prior_snapshot_sha256 = p_expected_snapshot_sha256
       AND v_step.status = 'retry_pending' AND v_run.control_state = 'paused'
       AND v_run.snapshot_revision = v_event.snapshot_revision
       AND v_run.control_revision = v_event.control_revision
       AND v_work.fencing_generation = v_event.fencing_generation
       AND v_work.claim_id IS NULL AND v_work.lease_until IS NULL THEN
      RETURN QUERY SELECT 'already_recovered', v_event.snapshot_revision, v_event.control_revision;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF v_run.status IS DISTINCT FROM 'running' OR v_run.control_state IS DISTINCT FROM 'active'
     OR v_run.failure_code IS NOT NULL OR v_run.completed_at IS NOT NULL
     OR v_run.accepted_request_id IS NULL OR v_run.acceptance_fingerprint IS NULL
     OR v_run.snapshot_revision IS DISTINCT FROM p_expected_snapshot_revision
     OR v_snapshot_sha256 IS DISTINCT FROM p_expected_snapshot_sha256
     OR (CASE WHEN pg_catalog.jsonb_typeof(v_run.execution_plan->'orderedStepIds') = 'array'
         THEN pg_catalog.jsonb_array_length(v_run.execution_plan->'orderedStepIds') END) IS DISTINCT FROM 3
     OR (CASE WHEN pg_catalog.jsonb_typeof(v_run.execution_plan->'steps') = 'array'
         THEN pg_catalog.jsonb_array_length(v_run.execution_plan->'steps') END) IS DISTINCT FROM 3
     OR v_step.capability_id IS DISTINCT FROM 'standard'
     OR v_step.status IS DISTINCT FROM 'running' OR v_step.attempt IS DISTINCT FROM 1
     OR v_step.execution_key IS DISTINCT FROM p_expected_execution_key
     OR v_step.started_at IS NULL OR v_step.completed_at IS NOT NULL
     OR v_step.result_envelope IS NOT NULL OR v_step.result_payload_id IS NOT NULL
     OR v_step.failure_code IS NOT NULL OR v_step.next_retry_at IS NOT NULL
     OR v_work.recovery_state IS DISTINCT FROM 'ready'
     OR v_work.claim_id IS DISTINCT FROM p_expected_claim_id
     OR v_work.fencing_generation IS DISTINCT FROM p_expected_fencing_generation
     OR v_work.lease_until IS NULL OR v_work.lease_until > v_now
     OR EXISTS (SELECT 1 FROM public.execution_run_finalizations AS receipt WHERE receipt.run_id = v_run.id)
     OR EXISTS (SELECT 1 FROM public.execution_human_approval_checkpoints AS checkpoint
         WHERE checkpoint.run_id = v_run.id AND checkpoint.user_id = v_run.user_id
           AND checkpoint.status <> 'approved') THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT acceptance.* INTO v_acceptance FROM public.agent_request_acceptances AS acceptance
  WHERE acceptance.request_id = v_run.accepted_request_id
    AND acceptance.user_id = v_run.user_id
    AND acceptance.request_fingerprint = v_run.acceptance_fingerprint FOR KEY SHARE;
  IF NOT FOUND OR v_run.runtime_context->'requestMessageBinding' IS DISTINCT FROM pg_catalog.jsonb_build_object(
       'requestId', v_acceptance.request_id, 'userId', v_acceptance.user_id,
       'conversationId', v_acceptance.conversation_id,
       'userMessageId', v_acceptance.user_message_id,
       'assistantMessageId', v_acceptance.assistant_message_id)
     OR v_run.runtime_context->>'conversationId' IS DISTINCT FROM v_acceptance.conversation_id::text
     OR v_run.idempotency_key IS DISTINCT FROM v_acceptance.idempotency_key
     OR NOT EXISTS (SELECT 1 FROM public.conversations AS conversation
         WHERE conversation.id = v_acceptance.conversation_id AND conversation.user_id = v_run.user_id)
     OR NOT EXISTS (SELECT 1 FROM public.messages AS message
         WHERE message.id = v_acceptance.user_message_id AND message.user_id = v_run.user_id
           AND message.conversation_id = v_acceptance.conversation_id AND message.role = 'user')
     OR NOT EXISTS (SELECT 1 FROM public.messages AS message
         WHERE message.id = v_acceptance.assistant_message_id AND message.user_id = v_run.user_id
           AND message.conversation_id = v_acceptance.conversation_id AND message.role = 'assistant') THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  -- The approved plan position is File Analysis -> Standard -> Document Generation.
  IF (SELECT pg_catalog.count(*) FROM public.execution_steps AS step
      WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id) <> 3
     OR EXISTS (SELECT 1 FROM public.execution_steps AS step
         WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
           AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.jsonb_array_elements(v_run.execution_plan->'steps') AS planned(value)
             WHERE planned.value->>'id' = step.step_id
               AND planned.value->>'capability' = step.capability_id
               AND planned.value->'dependsOn' = pg_catalog.to_jsonb(step.dependency_ids)
           ))
     OR NOT EXISTS (SELECT 1 FROM public.execution_steps AS step
         WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
           AND step.step_id = v_run.execution_plan->'orderedStepIds'->>0
           AND step.capability_id = 'file_analysis' AND step.status = 'succeeded'
           AND step.result_envelope IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.execution_steps AS step
         WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
           AND step.step_id = v_run.execution_plan->'orderedStepIds'->>2
           AND step.capability_id = 'document_generation' AND step.status = 'pending'
           AND step.dependency_ids @> ARRAY[v_step.step_id]::text[])
     OR NOT (v_step.dependency_ids @> ARRAY[v_run.execution_plan->'orderedStepIds'->>0]::text[])
     OR EXISTS (SELECT 1 FROM public.agent_provider_cost_admissions AS admission
         WHERE admission.run_id = v_run.id AND admission.user_id = v_run.user_id
           AND admission.step_id = v_step.step_id)
     OR EXISTS (SELECT 1 FROM public.execution_step_result_payloads AS payload
         WHERE payload.run_id = v_run.id AND payload.user_id = v_run.user_id
           AND payload.step_id = v_step.step_id) THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF v_run.snapshot->>'version' IS DISTINCT FROM '1'
     OR v_run.snapshot->>'runtimeVersion' IS DISTINCT FROM '1'
     OR v_run.snapshot->'snapshot'->'run'->>'value' IS DISTINCT FROM 'running'
     OR v_run.snapshot->'snapshot'->'run'->>'status' IS DISTINCT FROM 'active'
     OR pg_catalog.jsonb_typeof(v_run.snapshot->'snapshot'->'steps') IS DISTINCT FROM 'object'
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_run.snapshot->'snapshot'->'steps')) <> 3
     OR EXISTS (SELECT 1 FROM public.execution_steps AS step
         WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
           AND (v_run.snapshot->'snapshot'->'steps'->step.step_id->>'value' IS DISTINCT FROM step.status
             OR v_run.snapshot->'snapshot'->'steps'->step.step_id->>'status' IS DISTINCT FROM
               CASE WHEN step.status IN ('succeeded','failed','skipped') THEN 'done' ELSE 'active' END)) THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT claim.* INTO v_claim FROM public.execution_work_claim_history AS claim
  WHERE claim.claim_id = p_expected_claim_id AND claim.run_id = v_run.id
    AND claim.user_id = v_run.user_id FOR UPDATE;
  IF NOT FOUND OR v_claim.step_id IS DISTINCT FROM v_step.step_id
     OR v_claim.status IS DISTINCT FROM 'active'
     OR v_claim.fencing_generation IS DISTINCT FROM p_expected_fencing_generation
     OR v_claim.lease_until IS DISTINCT FROM v_work.lease_until
     OR v_claim.lease_until > v_now
     OR EXISTS (SELECT 1 FROM public.execution_work_claim_history AS competing
         WHERE competing.run_id = v_run.id AND competing.user_id = v_run.user_id
           AND competing.claim_id <> p_expected_claim_id
           AND competing.status = 'active' AND competing.lease_until > v_now) THEN
    RETURN QUERY SELECT 'stale_claim', NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  -- XState's supported running -> retry_pending transition changes only value.
  -- A control pause prevents any later scheduler from automatically claiming it.
  v_snapshot := pg_catalog.jsonb_set(v_run.snapshot,
    ARRAY['snapshot','steps',v_step.step_id,'value'], '"retry_pending"'::jsonb, false);
  UPDATE public.execution_work_claim_history AS claim
  SET status = 'expired', ended_at = v_now
  WHERE claim.claim_id = v_claim.claim_id AND claim.status = 'active'
    AND claim.fencing_generation = p_expected_fencing_generation;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PREDISPATCH_CLAIM_CONFLICT'; END IF;
  UPDATE public.execution_run_work_state AS work
  SET claim_id = NULL, lease_until = NULL, fencing_generation = p_expected_fencing_generation + 1,
      recovery_state = 'ready', available_at = v_now
  WHERE work.run_id = v_run.id AND work.user_id = v_run.user_id
    AND work.claim_id = p_expected_claim_id AND work.fencing_generation = p_expected_fencing_generation;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PREDISPATCH_WORK_CONFLICT'; END IF;
  UPDATE public.execution_steps AS step
  SET status = 'retry_pending', next_retry_at = v_now
  WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
    AND step.step_id = v_step.step_id AND step.status = 'running'
    AND step.execution_key = p_expected_execution_key;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PREDISPATCH_STEP_CONFLICT'; END IF;
  UPDATE public.execution_runs AS run
  SET snapshot = v_snapshot, snapshot_revision = p_expected_snapshot_revision + 1,
      control_state = 'paused', control_revision = run.control_revision + 1
  WHERE run.id = v_run.id AND run.user_id = v_run.user_id
    AND run.status = 'running' AND run.control_state = 'active'
    AND run.snapshot_revision = p_expected_snapshot_revision;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PREDISPATCH_SNAPSHOT_CONFLICT'; END IF;

  INSERT INTO public.execution_control_events (
    run_id, user_id, action, prior_state, new_state,
    prior_control_revision, control_revision, snapshot_revision, created_at
  ) VALUES (v_run.id, v_run.user_id, 'paused', 'active', 'paused',
    v_run.control_revision, v_run.control_revision + 1, p_expected_snapshot_revision + 1, v_now);
  INSERT INTO public.execution_predispatch_recovery_events (
    run_id, user_id, step_id, execution_key, expired_claim_id,
    prior_fencing_generation, fencing_generation,
    prior_snapshot_revision, prior_snapshot_sha256, snapshot_revision, control_revision, created_at
  ) VALUES (v_run.id, v_run.user_id, v_step.step_id, v_step.execution_key, v_claim.claim_id,
    p_expected_fencing_generation, p_expected_fencing_generation + 1,
    p_expected_snapshot_revision, p_expected_snapshot_sha256,
    p_expected_snapshot_revision + 1, v_run.control_revision + 1, v_now);

  RETURN QUERY SELECT 'recovered', p_expected_snapshot_revision + 1, v_run.control_revision + 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.recover_trusted_predispatch_standard_step(uuid,bigint,text,uuid,bigint,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_trusted_predispatch_standard_step(uuid,bigint,text,uuid,bigint,uuid)
  TO service_role;

COMMENT ON FUNCTION public.recover_trusted_predispatch_standard_step(uuid,bigint,text,uuid,bigint,uuid)
  IS 'Service-only fenced repair of a verified pre-dispatch Standard step into paused retry_pending state; performs no provider dispatch.';

COMMIT;
