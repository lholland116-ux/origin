BEGIN;

-- A one-purpose, service-only audit record for the explicitly approved
-- reconciliation of a document-generation persistence boundary. The artifact
-- identity is recorded for audit, but is never accepted from a client.
CREATE TABLE public.execution_document_recovery_events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_id text NOT NULL,
  execution_key uuid NOT NULL,
  recovery_claim_id uuid NOT NULL,
  fencing_generation bigint NOT NULL CHECK (fencing_generation > 0),
  generated_document_id uuid NOT NULL,
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action = 'document_generation_reconciled'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT execution_document_recovery_events_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_document_recovery_events_unique
    UNIQUE (run_id, step_id, execution_key, action)
);

ALTER TABLE public.execution_document_recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_document_recovery_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.execution_document_recovery_events FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reconcile_trusted_document_generation_artifact(
  p_run_id uuid,
  p_step_id text,
  p_execution_key uuid,
  p_expected_snapshot_revision bigint,
  p_snapshot jsonb,
  p_result_envelope jsonb,
  p_artifact_sha256 text
)
RETURNS TABLE (status text, snapshot_revision bigint, recovery_claim_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.execution_runs%ROWTYPE;
  v_step public.execution_steps%ROWTYPE;
  v_acceptance public.agent_request_acceptances%ROWTYPE;
  v_document public.generated_documents%ROWTYPE;
  v_work public.execution_run_work_state%ROWTYPE;
  v_claim_id uuid;
  v_generation bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_step_count integer;
  v_audit_count integer;
BEGIN
  IF p_run_id IS NULL OR p_step_id IS NULL OR pg_catalog.length(p_step_id) NOT BETWEEN 1 AND 128
     OR p_execution_key IS NULL OR p_expected_snapshot_revision IS NULL OR p_expected_snapshot_revision < 0
     OR p_snapshot IS NULL OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
     OR p_result_envelope IS NULL OR pg_catalog.jsonb_typeof(p_result_envelope) <> 'object'
     OR p_artifact_sha256 IS NULL OR p_artifact_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  -- The run lock serializes this operation with controls, claims and normal
  -- checkpoints. No caller-supplied user or artifact identity is trusted.
  SELECT run.* INTO v_run
  FROM public.execution_runs AS run
  WHERE run.id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  SELECT step.* INTO v_step
  FROM public.execution_steps AS step
  WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id AND step.step_id = p_step_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  IF v_step.status = 'succeeded' THEN
    SELECT count(*) INTO v_audit_count
    FROM public.execution_document_recovery_events AS event
    WHERE event.run_id = v_run.id AND event.step_id = v_step.step_id
      AND event.execution_key = v_step.execution_key
      AND event.action = 'document_generation_reconciled';
    IF v_audit_count = 1 THEN
      RETURN QUERY SELECT 'already_reconciled', v_run.snapshot_revision, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  IF v_run.status IS DISTINCT FROM 'running' OR v_run.control_state IS DISTINCT FROM 'active'
     OR v_run.failure_code IS NOT NULL OR v_run.completed_at IS NOT NULL
     OR v_run.accepted_request_id IS NULL OR v_run.acceptance_fingerprint IS NULL
     OR v_step.capability_id IS DISTINCT FROM 'document_generation' OR v_step.status IS DISTINCT FROM 'running'
     OR v_step.attempt IS DISTINCT FROM 1 OR v_step.execution_key IS DISTINCT FROM p_execution_key
     OR v_run.execution_plan IS NULL
     OR pg_catalog.jsonb_typeof(v_run.execution_plan->'orderedStepIds') IS DISTINCT FROM 'array'
     OR NOT COALESCE(v_run.execution_plan->'orderedStepIds' ? v_step.step_id, false)
     OR v_run.execution_plan->'orderedStepIds'->>(pg_catalog.jsonb_array_length(v_run.execution_plan->'orderedStepIds') - 1) IS DISTINCT FROM v_step.step_id
     OR v_run.snapshot_revision IS DISTINCT FROM p_expected_snapshot_revision THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  SELECT acceptance.* INTO v_acceptance
  FROM public.agent_request_acceptances AS acceptance
  WHERE acceptance.request_id = v_run.accepted_request_id
    AND acceptance.user_id = v_run.user_id
    AND acceptance.request_fingerprint = v_run.acceptance_fingerprint
  FOR KEY SHARE;
  IF NOT FOUND OR v_run.runtime_context->'requestMessageBinding' IS DISTINCT FROM pg_catalog.jsonb_build_object(
       'requestId', v_acceptance.request_id,
       'userId', v_acceptance.user_id,
       'conversationId', v_acceptance.conversation_id,
       'userMessageId', v_acceptance.user_message_id,
       'assistantMessageId', v_acceptance.assistant_message_id
     )
     OR v_run.runtime_context->>'conversationId' IS DISTINCT FROM v_acceptance.conversation_id::text
     OR v_run.idempotency_key IS DISTINCT FROM v_acceptance.idempotency_key THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations AS conversation
    WHERE conversation.id = v_acceptance.conversation_id AND conversation.user_id = v_run.user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.messages AS message
    WHERE message.id = v_acceptance.user_message_id
      AND message.user_id = v_run.user_id
      AND message.conversation_id = v_acceptance.conversation_id
      AND message.role = 'user'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.messages AS message
    WHERE message.id = v_acceptance.assistant_message_id
      AND message.user_id = v_run.user_id
      AND message.conversation_id = v_acceptance.conversation_id
      AND message.role = 'assistant'
  ) THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.execution_human_approval_checkpoints AS checkpoint
    WHERE checkpoint.run_id = v_run.id AND checkpoint.user_id = v_run.user_id
      AND checkpoint.status <> 'approved'
  ) OR EXISTS (
    SELECT 1 FROM public.execution_steps AS step
    WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
      AND step.step_id <> v_step.step_id AND step.status <> 'succeeded'
  ) THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  SELECT document.* INTO v_document
  FROM public.generated_documents AS document
  WHERE document.user_id = v_run.user_id
    AND document.conversation_id = v_acceptance.conversation_id
    AND document.generation_request_id = v_step.execution_key
  FOR UPDATE;
  IF NOT FOUND
     OR v_document.message_id IS DISTINCT FROM v_acceptance.assistant_message_id
     OR v_document.format IS DISTINCT FROM 'pdf' OR v_document.mime_type IS DISTINCT FROM 'application/pdf'
     OR v_document.storage_path IS DISTINCT FROM (
       v_document.user_id::text || '/' || v_document.conversation_id::text || '/generated/'
       || v_document.id::text || '/' || v_document.filename
     )
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects AS object
       WHERE object.bucket_id = 'documents' AND object.name = v_document.storage_path
     ) THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  IF NOT (
       p_result_envelope->>'kind' IS NOT DISTINCT FROM 'document'
       AND pg_catalog.jsonb_typeof(p_result_envelope->'value') IS NOT DISTINCT FROM 'object'
       AND p_result_envelope->'value'->>'kind' IS NOT DISTINCT FROM 'generated_document'
       AND p_result_envelope->'value'->>'artifactId' IS NOT DISTINCT FROM v_document.id::text
       AND p_result_envelope->'value'->>'conversationId' IS NOT DISTINCT FROM v_document.conversation_id::text
       AND p_result_envelope->'value'->>'messageId' IS NOT DISTINCT FROM v_document.message_id::text
       AND p_result_envelope->'value'->>'filename' IS NOT DISTINCT FROM v_document.filename
       AND p_result_envelope->'value'->>'format' IS NOT DISTINCT FROM v_document.format
       AND p_result_envelope->'value'->>'mimeType' IS NOT DISTINCT FROM v_document.mime_type
       AND (p_result_envelope->'value'->>'sizeBytes' ~ '^[0-9]+$') IS TRUE
       AND (p_result_envelope->'value'->>'sizeBytes')::bigint IS NOT DISTINCT FROM v_document.size_bytes
       AND (p_result_envelope->'value'->>'createdAt')::timestamptz IS NOT DISTINCT FROM v_document.created_at
       AND pg_catalog.octet_length(p_result_envelope::text) <= 65536
     ) THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  SELECT count(*) INTO v_step_count
  FROM public.execution_steps AS step
  WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id;
  IF NOT (
       p_snapshot->>'version' IS NOT DISTINCT FROM '1'
     AND p_snapshot->>'runtimeVersion' IS NOT DISTINCT FROM '1'
     AND pg_catalog.jsonb_typeof(p_snapshot->'snapshot') IS NOT DISTINCT FROM 'object'
     AND pg_catalog.jsonb_typeof(p_snapshot->'snapshot'->'steps') IS NOT DISTINCT FROM 'object'
     AND p_snapshot->'snapshot'->'run'->>'value' IS NOT DISTINCT FROM 'succeeded'
     AND p_snapshot->'snapshot'->'run'->>'status' IS NOT DISTINCT FROM 'done'
     AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_snapshot->'snapshot'->'steps')) = v_step_count
     AND p_snapshot->'snapshot'->'steps'->v_step.step_id->>'value' IS NOT DISTINCT FROM 'succeeded'
     AND p_snapshot->'snapshot'->'steps'->v_step.step_id->>'status' IS NOT DISTINCT FROM 'done'
     AND NOT EXISTS (
       SELECT 1 FROM public.execution_steps AS step
       WHERE step.run_id = v_run.id AND step.user_id = v_run.user_id
         AND (p_snapshot->'snapshot'->'steps'->step.step_id->>'value' IS DISTINCT FROM 'succeeded'
           OR p_snapshot->'snapshot'->'steps'->step.step_id->>'status' IS DISTINCT FROM 'done')
     )
     ) THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  SELECT work.* INTO v_work
  FROM public.execution_run_work_state AS work
  WHERE work.run_id = v_run.id AND work.user_id = v_run.user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_eligible', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;
  IF v_work.claim_id IS NOT NULL AND v_work.lease_until > v_now
     AND EXISTS (
       SELECT 1 FROM public.execution_work_claim_history AS claim
       WHERE claim.claim_id = v_work.claim_id AND claim.run_id = v_run.id
         AND claim.user_id = v_run.user_id AND claim.fencing_generation = v_work.fencing_generation
         AND claim.status = 'active' AND claim.lease_until > v_now
     ) THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.execution_work_claim_history AS claim
    WHERE claim.run_id = v_run.id AND claim.user_id = v_run.user_id
      AND claim.status = 'active' AND claim.lease_until > v_now
  ) THEN
    RETURN QUERY SELECT 'conflict', NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.execution_work_claim_history
  SET status = 'expired', ended_at = v_now
  WHERE run_id = v_run.id AND user_id = v_run.user_id
    AND execution_work_claim_history.status = 'active'
    AND execution_work_claim_history.lease_until <= v_now;

  v_generation := v_work.fencing_generation + 1;
  v_claim_id := extensions.gen_random_uuid();
  INSERT INTO public.execution_work_claim_history (
    claim_id, run_id, user_id, step_id, fencing_generation, status, claimed_at, lease_until
  ) VALUES (
    v_claim_id, v_run.id, v_run.user_id, v_step.step_id, v_generation, 'active', v_now,
    v_now + interval '120 seconds'
  );
  UPDATE public.execution_run_work_state
  SET claim_id = v_claim_id, lease_until = v_now + interval '120 seconds',
      fencing_generation = v_generation, recovery_state = 'ready', available_at = v_now
  WHERE run_id = v_run.id AND user_id = v_run.user_id;

  UPDATE public.execution_steps AS execution_step
  SET status = 'succeeded', result_envelope = p_result_envelope,
      failure_code = NULL, next_retry_at = NULL, completed_at = v_now
  WHERE execution_step.run_id = v_run.id AND execution_step.user_id = v_run.user_id AND execution_step.step_id = v_step.step_id
    AND execution_step.status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_CHECKPOINT_CONFLICT';
  END IF;

  UPDATE public.execution_runs AS execution_run
  SET status = 'succeeded', snapshot = p_snapshot,
      snapshot_revision = p_expected_snapshot_revision + 1,
      completed_at = v_now, runtime_context = runtime_context - 'userInput'
  WHERE execution_run.id = v_run.id AND execution_run.user_id = v_run.user_id
    AND execution_run.status = 'running' AND execution_run.snapshot_revision = p_expected_snapshot_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_SNAPSHOT_CONFLICT';
  END IF;

  INSERT INTO public.execution_document_recovery_events (
    run_id, user_id, step_id, execution_key, recovery_claim_id, fencing_generation,
    generated_document_id, artifact_sha256, action, created_at
  ) VALUES (
    v_run.id, v_run.user_id, v_step.step_id, v_step.execution_key, v_claim_id, v_generation,
    v_document.id, p_artifact_sha256, 'document_generation_reconciled', v_now
  );

  UPDATE public.execution_work_claim_history
  SET status = 'released', ended_at = v_now
  WHERE claim_id = v_claim_id AND run_id = v_run.id AND user_id = v_run.user_id AND execution_work_claim_history.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_CLAIM_RELEASE_FAILED';
  END IF;
  UPDATE public.execution_run_work_state
  SET claim_id = NULL, lease_until = NULL, recovery_state = 'ready', available_at = v_now
  WHERE run_id = v_run.id AND user_id = v_run.user_id AND claim_id = v_claim_id
    AND fencing_generation = v_generation;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECONCILIATION_WORK_RELEASE_FAILED';
  END IF;

  RETURN QUERY SELECT 'reconciled', p_expected_snapshot_revision + 1, v_claim_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_trusted_document_generation_artifact(uuid,text,uuid,bigint,jsonb,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_trusted_document_generation_artifact(uuid,text,uuid,bigint,jsonb,jsonb,text)
  TO service_role;

COMMENT ON FUNCTION public.reconcile_trusted_document_generation_artifact(uuid,text,uuid,bigint,jsonb,jsonb,text)
  IS 'Service-only, fenced reconciliation of an already-persisted PDF; artifact identity is derived from the accepted run execution key.';

COMMIT;
