BEGIN;

-- One immutable completion receipt per accepted execution. The assistant
-- message itself remains the source of the final text; this row records its
-- content digest and exact acceptance/message identity for durable replay.
CREATE TABLE public.execution_run_finalizations (
  run_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_message_id uuid NOT NULL,
  assistant_message_id uuid NOT NULL,
  completion_sha256 text NOT NULL CHECK (completion_sha256 ~ '^[0-9a-f]{64}$'),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_run_finalizations_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_run_finalizations_acceptance_fkey
    FOREIGN KEY (user_id, request_id) REFERENCES public.agent_request_acceptances(user_id, request_id) ON DELETE CASCADE,
  CONSTRAINT execution_run_finalizations_distinct_messages_check
    CHECK (user_message_id <> assistant_message_id)
);

ALTER TABLE public.execution_run_finalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_run_finalizations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.execution_run_finalizations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reject_execution_run_finalization_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND pg_catalog.pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Execution finalization receipts are immutable';
END;
$function$;

CREATE TRIGGER execution_run_finalizations_immutable
  BEFORE UPDATE OR DELETE ON public.execution_run_finalizations
  FOR EACH ROW EXECUTE FUNCTION public.reject_execution_run_finalization_mutation();
REVOKE ALL ON FUNCTION public.reject_execution_run_finalization_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX execution_runs_pending_finalization_idx
  ON public.execution_runs (completed_at, id)
  WHERE accepted_request_id IS NOT NULL
    AND status = 'succeeded'
    AND control_state = 'active';

CREATE FUNCTION public.finalize_accepted_agent_execution(
  p_run_id uuid,
  p_final_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.execution_runs%ROWTYPE;
  v_acceptance public.agent_request_acceptances%ROWTYPE;
  v_user_message_created_at timestamptz;
  v_assistant_message_created_at timestamptz;
  v_assistant_content text;
  v_pending_marker text;
  v_completion_sha256 text;
  v_finalization public.execution_run_finalizations%ROWTYPE;
  v_step_count integer;
  v_succeeded_step_count integer;
  v_expected_step_count integer;
BEGIN
  IF p_run_id IS NULL OR p_final_text IS NULL OR pg_catalog.btrim(p_final_text) = ''
     OR pg_catalog.length(p_final_text) > 200000
     OR pg_catalog.left(p_final_text, pg_catalog.char_length('[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:'))
        = '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_EXECUTION_FINALIZATION';
  END IF;

  -- The run lock serializes finalization with every human-control transaction.
  SELECT run.* INTO v_run
  FROM public.execution_runs AS run
  WHERE run.id = p_run_id
  FOR UPDATE;
  IF NOT FOUND OR v_run.accepted_request_id IS NULL
     OR v_run.acceptance_fingerprint IS NULL
     OR v_run.status <> 'succeeded' OR v_run.completed_at IS NULL
     OR v_run.failure_code IS NOT NULL OR v_run.control_state <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_NOT_FINALIZABLE';
  END IF;

  -- Owner and message authority are derived from the immutable accepted-request
  -- ledger, not from caller-supplied user/conversation/message identifiers.
  SELECT acceptance.* INTO v_acceptance
  FROM public.agent_request_acceptances AS acceptance
  WHERE acceptance.request_id = v_run.accepted_request_id
    AND acceptance.user_id = v_run.user_id
  FOR KEY SHARE;
  IF NOT FOUND OR v_acceptance.request_fingerprint <> v_run.acceptance_fingerprint
     OR v_run.runtime_context->'requestMessageBinding' IS DISTINCT FROM pg_catalog.jsonb_build_object(
       'requestId', v_acceptance.request_id,
       'userId', v_acceptance.user_id,
       'conversationId', v_acceptance.conversation_id,
       'userMessageId', v_acceptance.user_message_id,
       'assistantMessageId', v_acceptance.assistant_message_id
     )
     OR v_run.runtime_context->>'conversationId' IS DISTINCT FROM v_acceptance.conversation_id::text
     OR v_run.idempotency_key IS DISTINCT FROM v_acceptance.idempotency_key THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_BINDING_CONFLICT';
  END IF;

  v_expected_step_count := pg_catalog.jsonb_array_length(v_run.execution_plan->'orderedStepIds');
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(*) FILTER (WHERE step.status = 'succeeded')::integer
    INTO v_step_count, v_succeeded_step_count
  FROM public.execution_steps AS step
  WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id;
  IF v_expected_step_count < 1 OR v_step_count <> v_expected_step_count
     OR v_succeeded_step_count <> v_step_count
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements_text(v_run.execution_plan->'orderedStepIds') AS planned(step_id)
       LEFT JOIN public.execution_steps AS step
         ON step.run_id = v_run.id AND step.user_id = v_run.user_id
        AND step.step_id = planned.step_id
       WHERE step.step_id IS NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.execution_steps AS step
       WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
         AND NOT (v_run.execution_plan->'orderedStepIds' ? step.step_id)
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_STEPS_INCOMPLETE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.execution_human_approval_checkpoints AS checkpoint
    WHERE checkpoint.run_id = v_run.id AND checkpoint.user_id = v_run.user_id
      AND checkpoint.status <> 'approved'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_APPROVAL_PENDING';
  END IF;

  SELECT message.created_at INTO v_user_message_created_at
  FROM public.messages AS message
  WHERE message.id = v_acceptance.user_message_id
    AND message.user_id = v_acceptance.user_id
    AND message.conversation_id = v_acceptance.conversation_id
    AND message.role = 'user'
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_BINDING_CONFLICT';
  END IF;

  SELECT message.created_at, message.content
    INTO v_assistant_message_created_at, v_assistant_content
  FROM public.messages AS message
  WHERE message.id = v_acceptance.assistant_message_id
    AND message.user_id = v_acceptance.user_id
    AND message.conversation_id = v_acceptance.conversation_id
    AND message.role = 'assistant'
  FOR UPDATE;
  IF NOT FOUND OR v_assistant_message_created_at < v_user_message_created_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_BINDING_CONFLICT';
  END IF;

  v_pending_marker := '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:'
    || v_acceptance.request_id::text || ':' || v_acceptance.user_message_id::text || ']]';
  v_completion_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_final_text, 'UTF8'), 'sha256'), 'hex'
  );

  SELECT receipt.* INTO v_finalization
  FROM public.execution_run_finalizations AS receipt
  WHERE receipt.run_id = v_run.id
  FOR UPDATE;
  IF FOUND THEN
    IF v_finalization.user_id <> v_acceptance.user_id
       OR v_finalization.request_id <> v_acceptance.request_id
       OR v_finalization.conversation_id <> v_acceptance.conversation_id
       OR v_finalization.user_message_id <> v_acceptance.user_message_id
       OR v_finalization.assistant_message_id <> v_acceptance.assistant_message_id
       OR v_finalization.completion_sha256 <> v_completion_sha256
       OR v_assistant_content IS DISTINCT FROM p_final_text THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_FINALIZATION_CONFLICT';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'status', 'replayed', 'runId', v_run.id,
      'assistantMessageId', v_acceptance.assistant_message_id,
      'completionSha256', v_completion_sha256,
      'finalizedAt', v_finalization.finalized_at
    );
  END IF;

  -- A prior call through the existing authenticated finalizer may already have
  -- written this exact response. Adopt only exact identical content; never
  -- overwrite a different response or a non-pending assistant row.
  IF v_assistant_content = v_pending_marker THEN
    UPDATE public.messages AS message
    SET content = p_final_text
    WHERE message.id = v_acceptance.assistant_message_id
      AND message.user_id = v_acceptance.user_id
      AND message.conversation_id = v_acceptance.conversation_id
      AND message.role = 'assistant'
      AND message.content = v_pending_marker;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_FINALIZATION_CONFLICT';
    END IF;
  ELSIF v_assistant_content IS DISTINCT FROM p_final_text THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_EXECUTION_FINALIZATION_CONFLICT';
  END IF;

  INSERT INTO public.execution_run_finalizations (
    run_id, user_id, request_id, conversation_id, user_message_id,
    assistant_message_id, completion_sha256
  ) VALUES (
    v_run.id, v_acceptance.user_id, v_acceptance.request_id,
    v_acceptance.conversation_id, v_acceptance.user_message_id,
    v_acceptance.assistant_message_id, v_completion_sha256
  ) RETURNING * INTO v_finalization;

  UPDATE public.conversations
  SET updated_at = pg_catalog.now()
  WHERE id = v_acceptance.conversation_id AND user_id = v_acceptance.user_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'finalized', 'runId', v_run.id,
    'assistantMessageId', v_acceptance.assistant_message_id,
    'completionSha256', v_completion_sha256,
    'finalizedAt', v_finalization.finalized_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_accepted_agent_execution(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_accepted_agent_execution(uuid, text)
  TO service_role;
COMMENT ON FUNCTION public.finalize_accepted_agent_execution(uuid, text) IS
  'Atomically finalizes a successful acceptance-ledger-backed run into its immutable assistant destination; service-role only, no owner authority accepted from caller.';

-- A worker or operator can rediscover succeeded accepted runs lacking a
-- receipt after a process crash. This is discovery only: it does not dispatch.
CREATE FUNCTION public.list_pending_agent_execution_finalizations(p_limit integer DEFAULT 100)
RETURNS TABLE(run_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_FINALIZATION_BATCH_SIZE';
  END IF;
  RETURN QUERY
  SELECT run.id
  FROM public.execution_runs AS run
  WHERE run.accepted_request_id IS NOT NULL
    AND run.status = 'succeeded'
    AND run.control_state = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.execution_steps AS step
      WHERE step.run_id = run.id AND step.user_id = run.user_id
        AND step.status <> 'succeeded'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.execution_human_approval_checkpoints AS checkpoint
      WHERE checkpoint.run_id = run.id AND checkpoint.user_id = run.user_id
        AND checkpoint.status <> 'approved'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.execution_run_finalizations AS receipt
      WHERE receipt.run_id = run.id
    )
  ORDER BY run.completed_at, run.id
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_pending_agent_execution_finalizations(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_agent_execution_finalizations(integer)
  TO service_role;
COMMENT ON FUNCTION public.list_pending_agent_execution_finalizations(integer) IS
  'Lists bounded, succeeded accepted execution run IDs with no completion receipt for crash recovery; never dispatches work.';

COMMIT;
