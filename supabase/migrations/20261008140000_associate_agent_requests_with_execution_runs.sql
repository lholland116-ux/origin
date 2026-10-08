BEGIN;

-- Keep the acceptance identity distinct from the plan/runtime fingerprint.
-- Existing direct runtime callers remain unassociated (both columns NULL).
ALTER TABLE public.execution_runs
  ADD COLUMN accepted_request_id uuid,
  ADD COLUMN acceptance_fingerprint text,
  ADD CONSTRAINT execution_runs_acceptance_identity_pair_check CHECK (
    (accepted_request_id IS NULL AND acceptance_fingerprint IS NULL)
    OR (accepted_request_id IS NOT NULL AND acceptance_fingerprint ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT execution_runs_accepted_request_unique UNIQUE (accepted_request_id),
  ADD CONSTRAINT execution_runs_accepted_request_owner_fkey
    FOREIGN KEY (user_id, accepted_request_id)
    REFERENCES public.agent_request_acceptances(user_id, request_id)
    ON DELETE CASCADE;

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
     OR NEW.execution_plan IS DISTINCT FROM OLD.execution_plan
     OR NEW.runtime_context -> 'requestMessageBinding'
        IS DISTINCT FROM OLD.runtime_context -> 'requestMessageBinding'
     OR NEW.accepted_request_id IS DISTINCT FROM OLD.accepted_request_id
     OR NEW.acceptance_fingerprint IS DISTINCT FROM OLD.acceptance_fingerprint THEN
    RAISE EXCEPTION 'Execution plan identity is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.associate_agent_request_execution_run(
  p_acceptance jsonb,
  p_run jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request_id uuid;
  v_user_id uuid;
  v_conversation_id uuid;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_idempotency_key text;
  v_acceptance_fingerprint text;
  v_run_id uuid;
  v_handoff_version integer;
  v_plan_fingerprint text;
  v_execution_plan jsonb;
  v_runtime_context jsonb;
  v_snapshot jsonb;
  v_created_at timestamptz;
  v_steps jsonb;
  v_approval_checkpoints jsonb;
  v_existing public.execution_runs%ROWTYPE;
  v_acceptance public.agent_request_acceptances%ROWTYPE;
  v_user_message_created_at timestamptz;
  v_assistant_content text;
  v_assistant_message_created_at timestamptz;
  v_control_revision bigint := 0;
  v_checkpoint jsonb;
BEGIN
  IF p_acceptance IS NULL OR pg_catalog.jsonb_typeof(p_acceptance) <> 'object'
     OR p_run IS NULL OR pg_catalog.jsonb_typeof(p_run) <> 'object'
     OR NOT (p_acceptance ?& ARRAY[
       'requestId', 'userId', 'conversationId', 'userMessageId',
       'assistantMessageId', 'idempotencyKey', 'requestFingerprint'
     ])
     OR NOT (p_run ?& ARRAY[
       'id', 'handoffVersion', 'planFingerprint', 'executionPlan',
       'runtimeContext', 'snapshot', 'createdAt', 'steps'
     ]) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_EXECUTION_ASSOCIATION';
  END IF;

  v_request_id := (p_acceptance->>'requestId')::uuid;
  v_user_id := (p_acceptance->>'userId')::uuid;
  v_conversation_id := (p_acceptance->>'conversationId')::uuid;
  v_user_message_id := (p_acceptance->>'userMessageId')::uuid;
  v_assistant_message_id := (p_acceptance->>'assistantMessageId')::uuid;
  v_idempotency_key := p_acceptance->>'idempotencyKey';
  v_acceptance_fingerprint := p_acceptance->>'requestFingerprint';
  v_run_id := (p_run->>'id')::uuid;
  v_handoff_version := (p_run->>'handoffVersion')::integer;
  v_plan_fingerprint := p_run->>'planFingerprint';
  v_execution_plan := p_run->'executionPlan';
  v_runtime_context := p_run->'runtimeContext';
  v_snapshot := p_run->'snapshot';
  v_created_at := (p_run->>'createdAt')::timestamptz;
  v_steps := p_run->'steps';
  v_approval_checkpoints := COALESCE(p_run->'approvalCheckpoints', '[]'::jsonb);

  IF v_user_message_id = v_assistant_message_id
     OR v_idempotency_key IS NULL
     OR pg_catalog.length(v_idempotency_key) NOT BETWEEN 1 AND 128
     OR v_idempotency_key <> pg_catalog.btrim(v_idempotency_key)
     OR v_acceptance_fingerprint !~ '^[0-9a-f]{64}$'
     OR v_handoff_version <> 1
     OR v_plan_fingerprint !~ '^[0-9a-f]{64}$'
     OR pg_catalog.jsonb_typeof(v_execution_plan) <> 'object'
     OR v_execution_plan->>'version' <> '1'
     OR pg_catalog.jsonb_typeof(v_execution_plan->'steps') <> 'array'
     OR pg_catalog.jsonb_typeof(v_execution_plan->'orderedStepIds') <> 'array'
     OR pg_catalog.jsonb_typeof(v_runtime_context) <> 'object'
     OR pg_catalog.jsonb_typeof(v_snapshot) <> 'object'
     OR pg_catalog.jsonb_typeof(v_steps) <> 'array'
     OR pg_catalog.jsonb_array_length(v_steps) < 1
     OR pg_catalog.jsonb_array_length(v_steps) > 6
     OR pg_catalog.jsonb_array_length(v_steps) <> pg_catalog.jsonb_array_length(v_execution_plan->'steps')
     OR pg_catalog.jsonb_array_length(v_steps) <> pg_catalog.jsonb_array_length(v_execution_plan->'orderedStepIds')
     OR pg_catalog.jsonb_typeof(v_approval_checkpoints) <> 'array'
     OR v_runtime_context->>'conversationId' <> v_conversation_id::text
     OR v_runtime_context->'requestMessageBinding' IS DISTINCT FROM jsonb_build_object(
       'requestId', v_request_id,
       'userId', v_user_id,
       'conversationId', v_conversation_id,
       'userMessageId', v_user_message_id,
       'assistantMessageId', v_assistant_message_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_EXECUTION_ASSOCIATION';
  END IF;

  -- Locking this immutable ledger row serializes every association attempt for
  -- this request and proves the caller's full identity against the DB source.
  SELECT acceptance.* INTO v_acceptance
  FROM public.agent_request_acceptances AS acceptance
  WHERE acceptance.request_id = v_request_id
    AND acceptance.user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_acceptance.conversation_id <> v_conversation_id
     OR v_acceptance.user_message_id <> v_user_message_id
     OR v_acceptance.assistant_message_id <> v_assistant_message_id
     OR v_acceptance.idempotency_key <> v_idempotency_key
     OR v_acceptance.request_fingerprint <> v_acceptance_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_REQUEST_EXECUTION_ASSOCIATION_CONFLICT';
  END IF;

  SELECT message.created_at INTO v_user_message_created_at
  FROM public.messages AS message
  WHERE message.id = v_user_message_id
    AND message.user_id = v_user_id
    AND message.conversation_id = v_conversation_id
    AND message.role = 'user'
  FOR KEY SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.conversations AS conversation
    WHERE conversation.id = v_conversation_id AND conversation.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_REQUEST_EXECUTION_ASSOCIATION_CONFLICT';
  END IF;

  SELECT message.created_at, message.content
  INTO v_assistant_message_created_at, v_assistant_content
  FROM public.messages AS message
  WHERE message.id = v_assistant_message_id
    AND message.user_id = v_user_id
    AND message.conversation_id = v_conversation_id
    AND message.role = 'assistant'
  FOR KEY SHARE;
  IF NOT FOUND OR v_assistant_message_created_at < v_user_message_created_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_REQUEST_EXECUTION_ASSOCIATION_CONFLICT';
  END IF;

  SELECT run.* INTO v_existing
  FROM public.execution_runs AS run
  WHERE run.accepted_request_id = v_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id <> v_user_id
       OR v_existing.acceptance_fingerprint <> v_acceptance_fingerprint
       OR v_existing.idempotency_key <> v_idempotency_key
       OR v_existing.runtime_context->'requestMessageBinding' IS DISTINCT FROM
         v_runtime_context->'requestMessageBinding' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_REQUEST_EXECUTION_ASSOCIATION_CONFLICT';
    END IF;
    RETURN jsonb_build_object(
      'status', 'existing',
      'runId', v_existing.id,
      'runStatus', v_existing.status,
      'planFingerprint', v_existing.request_fingerprint
    );
  END IF;

  -- Do not adopt a run created through the separate legacy API; it has no
  -- ledger-backed proof that it belongs to this accepted request.
  IF EXISTS (
    SELECT 1 FROM public.execution_runs AS run
    WHERE run.user_id = v_user_id AND run.idempotency_key = v_idempotency_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_REQUEST_EXECUTION_ASSOCIATION_CONFLICT';
  END IF;

  IF v_assistant_content IS DISTINCT FROM
    '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:' || v_request_id::text || ':' || v_user_message_id::text || ']]' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_REQUEST_EXECUTION_ASSOCIATION_CONFLICT';
  END IF;

  INSERT INTO public.execution_runs (
    id, user_id, handoff_version, idempotency_key, request_fingerprint,
    execution_plan, runtime_context, snapshot_schema_version, snapshot,
    accepted_request_id, acceptance_fingerprint, created_at
  ) VALUES (
    v_run_id, v_user_id, v_handoff_version, v_idempotency_key, v_plan_fingerprint,
    v_execution_plan, v_runtime_context, 1, v_snapshot,
    v_request_id, v_acceptance_fingerprint, v_created_at
  );

  INSERT INTO public.execution_steps (
    run_id, user_id, step_id, capability_id, dependency_ids, attempt, execution_key
  )
  SELECT
    v_run_id,
    v_user_id,
    step.value->>'stepId',
    step.value->>'capabilityId',
    ARRAY(SELECT pg_catalog.jsonb_array_elements_text(step.value->'dependencyIds')),
    1,
    (step.value->>'executionKey')::uuid
  FROM pg_catalog.jsonb_array_elements(v_steps) AS step(value);

  FOR v_checkpoint IN SELECT value FROM pg_catalog.jsonb_array_elements(v_approval_checkpoints) AS item(value)
  LOOP
    INSERT INTO public.execution_human_approval_checkpoints (
      id, run_id, user_id, step_id, plan_fingerprint, step_fingerprint, source, created_at
    ) VALUES (
      (v_checkpoint->>'id')::uuid, v_run_id, v_user_id, v_checkpoint->>'stepId',
      v_plan_fingerprint, v_checkpoint->>'stepFingerprint', 'runtime_policy', v_created_at
    );
    v_control_revision := v_control_revision + 1;
    UPDATE public.execution_runs SET control_revision = v_control_revision
    WHERE id = v_run_id AND user_id = v_user_id;
    INSERT INTO public.execution_control_events (
      run_id, user_id, checkpoint_id, action, prior_state, new_state,
      prior_control_revision, control_revision, snapshot_revision, created_at
    ) VALUES (
      v_run_id, v_user_id, (v_checkpoint->>'id')::uuid, 'approval_required',
      'active', 'active', v_control_revision - 1, v_control_revision, 0, v_created_at
    );
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'runId', v_run_id,
    'runStatus', 'pending',
    'planFingerprint', v_plan_fingerprint
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.associate_agent_request_execution_run(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.associate_agent_request_execution_run(jsonb, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.associate_agent_request_execution_run(jsonb, jsonb)
  IS 'Atomically verifies an immutable agent request acceptance and creates or retrieves its sole durable execution run. Does not dispatch capabilities.';

COMMIT;
