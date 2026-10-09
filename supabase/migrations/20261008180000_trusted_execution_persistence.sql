BEGIN;

-- A worker subject is derived from the immutable acceptance/run association and
-- a currently leased, fenced step. The helper returns no caller-supplied owner.
ALTER TABLE public.image_generation_attempts
  ADD COLUMN execution_run_id uuid,
  ADD COLUMN execution_step_id text,
  ADD COLUMN execution_key uuid,
  ADD COLUMN execution_claim_id uuid,
  ADD COLUMN execution_fencing_generation bigint,
  ADD COLUMN generated_image_id uuid,
  ADD CONSTRAINT image_generation_attempts_execution_binding_check CHECK (
    (execution_run_id IS NULL AND execution_step_id IS NULL AND execution_key IS NULL
      AND execution_claim_id IS NULL AND execution_fencing_generation IS NULL)
    OR (execution_run_id IS NOT NULL AND execution_step_id IS NOT NULL AND execution_key IS NOT NULL
      AND execution_claim_id IS NOT NULL AND execution_fencing_generation > 0)
  ),
  ADD CONSTRAINT image_generation_attempts_execution_step_fkey
    FOREIGN KEY (execution_run_id, execution_step_id)
    REFERENCES public.execution_steps(run_id, step_id) ON DELETE CASCADE,
  ADD CONSTRAINT image_generation_attempts_generated_image_fkey
    FOREIGN KEY (generated_image_id) REFERENCES public.message_generated_images(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX image_generation_attempts_execution_key
  ON public.image_generation_attempts (execution_run_id, execution_step_id, execution_key)
  WHERE execution_run_id IS NOT NULL;

CREATE FUNCTION public.resolve_trusted_agent_execution_subject(
  p_run_id uuid,
  p_step_id text,
  p_execution_key uuid,
  p_claim_id uuid,
  p_fencing_generation bigint,
  p_allow_pending boolean DEFAULT false
)
RETURNS TABLE (
  request_id uuid,
  user_id uuid,
  conversation_id uuid,
  user_message_id uuid,
  assistant_message_id uuid,
  capability_id text,
  reasoning_mode text,
  plan text,
  attempt_number smallint,
  execution_key uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.execution_runs%ROWTYPE;
  v_acceptance public.agent_request_acceptances%ROWTYPE;
  v_step public.execution_steps%ROWTYPE;
  v_work public.execution_run_work_state%ROWTYPE;
  v_plan text;
BEGIN
  IF p_run_id IS NULL OR p_step_id IS NULL OR p_execution_key IS NULL
     OR p_claim_id IS NULL OR p_fencing_generation IS NULL OR p_fencing_generation < 1 OR p_allow_pending IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EXECUTION_SUBJECT';
  END IF;

  SELECT run.* INTO v_run
  FROM public.execution_runs AS run
  WHERE run.id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EXECUTION_SUBJECT_UNAVAILABLE'; END IF;
  -- Match the run -> work_state order used by claim/renew/release RPCs.
  SELECT work.* INTO v_work FROM public.execution_run_work_state AS work
  WHERE work.run_id = p_run_id AND work.user_id = v_run.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EXECUTION_SUBJECT_UNAVAILABLE'; END IF;

  SELECT step.* INTO v_step FROM public.execution_steps AS step
  WHERE step.run_id = p_run_id AND step.user_id = v_run.user_id AND step.step_id = p_step_id
  FOR UPDATE;
  SELECT acceptance.* INTO v_acceptance
  FROM public.agent_request_acceptances AS acceptance
  WHERE acceptance.request_id = v_run.accepted_request_id AND acceptance.user_id = v_run.user_id;
  SELECT profile.plan INTO v_plan FROM public.profiles AS profile
  WHERE profile.id = v_run.user_id FOR SHARE;

  IF v_work.run_id IS NULL OR v_step.run_id IS NULL OR v_acceptance.request_id IS NULL
     OR v_run.accepted_request_id IS NULL OR v_run.acceptance_fingerprint IS NULL
     OR v_acceptance.request_fingerprint IS DISTINCT FROM v_run.acceptance_fingerprint
     OR v_acceptance.idempotency_key IS DISTINCT FROM v_run.idempotency_key
     OR (NOT p_allow_pending AND v_run.status <> 'running')
     OR (p_allow_pending AND v_run.status NOT IN ('pending','running'))
     OR v_run.control_state <> 'active'
     OR (NOT p_allow_pending AND v_step.status <> 'running')
     OR (p_allow_pending AND v_step.status NOT IN ('pending','retry_pending','running'))
     OR v_step.execution_key <> p_execution_key
     OR v_step.capability_id NOT IN ('standard', 'file_analysis', 'document_generation', 'image_generation')
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(v_run.execution_plan->'steps') AS plan_step(value)
       WHERE plan_step.value->>'id' = v_step.step_id
         AND plan_step.value->>'capability' = v_step.capability_id
     )
     OR v_work.claim_id <> p_claim_id OR v_work.fencing_generation <> p_fencing_generation
     OR v_work.lease_until <= pg_catalog.clock_timestamp() OR v_work.recovery_state <> 'ready'
     OR NOT EXISTS (
       SELECT 1 FROM public.execution_work_claim_history AS claim
       WHERE claim.claim_id = p_claim_id AND claim.run_id = p_run_id
         AND claim.user_id = v_run.user_id AND claim.step_id = p_step_id
         AND claim.fencing_generation = p_fencing_generation AND claim.status = 'active'
         AND claim.lease_until > pg_catalog.clock_timestamp()
     )
     OR NOT public.agent_execution_work_claim_is_current(p_run_id, v_run.user_id, p_claim_id, p_fencing_generation)
     OR EXISTS (
       SELECT 1 FROM public.execution_human_approval_checkpoints AS checkpoint
       WHERE checkpoint.run_id = p_run_id AND checkpoint.step_id = p_step_id AND checkpoint.status = 'pending'
     )
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = v_run.user_id)
     OR EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = v_run.user_id
       AND (account.deleted_at IS NOT NULL OR (account.banned_until IS NOT NULL AND account.banned_until > pg_catalog.clock_timestamp())))
     OR v_plan IS NULL OR v_plan NOT IN ('free', 'pro')
     OR (v_acceptance.request_options ? 'reasoningMode'
       AND v_acceptance.request_options->>'reasoningMode' NOT IN ('instant', 'medium', 'high'))
     OR (v_acceptance.request_options->>'reasoningMode' = 'high' AND v_plan <> 'pro')
     OR NOT EXISTS (SELECT 1 FROM public.conversations AS conversation
       WHERE conversation.id = v_acceptance.conversation_id AND conversation.user_id = v_run.user_id)
     OR NOT EXISTS (SELECT 1 FROM public.messages AS user_message
       WHERE user_message.id = v_acceptance.user_message_id AND user_message.user_id = v_run.user_id
         AND user_message.conversation_id = v_acceptance.conversation_id AND user_message.role = 'user')
     OR NOT EXISTS (SELECT 1 FROM public.messages AS assistant_message
       WHERE assistant_message.id = v_acceptance.assistant_message_id AND assistant_message.user_id = v_run.user_id
         AND assistant_message.conversation_id = v_acceptance.conversation_id AND assistant_message.role = 'assistant')
     OR v_run.runtime_context #>> '{requestMessageBinding,requestId}' IS DISTINCT FROM v_acceptance.request_id::text
     OR v_run.runtime_context #>> '{requestMessageBinding,userId}' IS DISTINCT FROM v_run.user_id::text
     OR v_run.runtime_context #>> '{requestMessageBinding,conversationId}' IS DISTINCT FROM v_acceptance.conversation_id::text
     OR v_run.runtime_context #>> '{requestMessageBinding,userMessageId}' IS DISTINCT FROM v_acceptance.user_message_id::text
     OR v_run.runtime_context #>> '{requestMessageBinding,assistantMessageId}' IS DISTINCT FROM v_acceptance.assistant_message_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EXECUTION_SUBJECT_UNAVAILABLE';
  END IF;

  PERFORM 1 FROM public.messages AS message WHERE message.id IN
    (v_acceptance.user_message_id, v_acceptance.assistant_message_id)
    AND message.user_id = v_run.user_id AND message.conversation_id = v_acceptance.conversation_id
  FOR KEY SHARE;
  RETURN QUERY SELECT v_acceptance.request_id, v_run.user_id, v_acceptance.conversation_id,
    v_acceptance.user_message_id, v_acceptance.assistant_message_id, v_step.capability_id,
    v_acceptance.request_options->>'reasoningMode', v_plan, v_step.attempt, v_step.execution_key;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_trusted_agent_execution_subject(uuid, text, uuid, uuid, bigint, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_trusted_agent_execution_subject(uuid, text, uuid, uuid, bigint, boolean)
  TO service_role;

CREATE FUNCTION public.reserve_trusted_image_generation_quota(
  p_run_id uuid, p_step_id text, p_execution_key uuid, p_claim_id uuid, p_fencing_generation bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_subject record;
  v_existing public.image_generation_attempts%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day_start timestamptz;
  v_month_start timestamptz;
  v_daily_limit integer;
  v_monthly_limit integer;
  v_used_day bigint;
  v_reserved_day bigint;
  v_used_month bigint;
  v_reserved_month bigint;
  v_attempt_id uuid;
BEGIN
  SELECT * INTO v_subject FROM public.resolve_trusted_agent_execution_subject(
    p_run_id, p_step_id, p_execution_key, p_claim_id, p_fencing_generation
  );
  IF v_subject.capability_id <> 'image_generation' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EXECUTION_SUBJECT_UNAVAILABLE';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_subject.user_id::text, 0));

  SELECT attempt.* INTO v_existing FROM public.image_generation_attempts AS attempt
  WHERE attempt.execution_run_id = p_run_id AND attempt.execution_step_id = p_step_id
    AND attempt.execution_key = p_execution_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id <> v_subject.user_id OR v_existing.conversation_id <> v_subject.conversation_id
       OR v_existing.execution_claim_id <> p_claim_id
       OR v_existing.execution_fencing_generation <> p_fencing_generation
       OR v_existing.status = 'released' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_QUOTA_REPLAY_CONFLICT';
    END IF;
    RETURN v_existing.id;
  END IF;

  -- Keep autonomous image generation aligned with the standalone quota RPC.
  v_daily_limit := CASE WHEN v_subject.plan = 'pro' THEN 20 ELSE 3 END;
  v_monthly_limit := CASE WHEN v_subject.plan = 'pro' THEN 200 ELSE 21 END;
  v_day_start := (pg_catalog.date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
  v_month_start := (pg_catalog.date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
  UPDATE public.image_generation_attempts AS attempt SET status = 'released', released_at = v_now, release_reason = 'expired'
  WHERE attempt.user_id = v_subject.user_id AND attempt.status = 'reserved' AND attempt.expires_at <= v_now;
  SELECT count(*) FILTER (WHERE attempt.status = 'succeeded' AND attempt.completed_at >= v_day_start),
         count(*) FILTER (WHERE attempt.status = 'reserved' AND attempt.expires_at > v_now),
         count(*) FILTER (WHERE attempt.status = 'succeeded' AND attempt.completed_at >= v_month_start),
         count(*) FILTER (WHERE attempt.status = 'reserved' AND attempt.expires_at > v_now)
    INTO v_used_day, v_reserved_day, v_used_month, v_reserved_month
  FROM public.image_generation_attempts AS attempt WHERE attempt.user_id = v_subject.user_id;
  IF v_used_day + v_reserved_day >= v_daily_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_DAILY_LIMIT_REACHED';
  END IF;
  IF v_used_month + v_reserved_month >= v_monthly_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_MONTHLY_LIMIT_REACHED';
  END IF;
  INSERT INTO public.image_generation_attempts (
    user_id, conversation_id, plan_snapshot, status, reserved_at, expires_at,
    execution_run_id, execution_step_id, execution_key, execution_claim_id, execution_fencing_generation
  ) VALUES (
    v_subject.user_id, v_subject.conversation_id, v_subject.plan, 'reserved', v_now, v_now + interval '15 minutes',
    p_run_id, p_step_id, p_execution_key, p_claim_id, p_fencing_generation
  ) RETURNING id INTO v_attempt_id;
  RETURN v_attempt_id;
END;
$function$;

CREATE FUNCTION public.start_trusted_image_generation_attempt(
  p_run_id uuid, p_step_id text, p_execution_key uuid, p_claim_id uuid, p_fencing_generation bigint,
  p_attempt_id uuid, p_provider text, p_model text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_subject record;
  v_attempt public.image_generation_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_subject FROM public.resolve_trusted_agent_execution_subject(
    p_run_id, p_step_id, p_execution_key, p_claim_id, p_fencing_generation
  );
  IF v_subject.capability_id <> 'image_generation' OR p_provider <> 'replicate' OR p_model <> 'flux-schnell' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EXECUTION_SUBJECT_UNAVAILABLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.run_id = p_run_id AND admission.step_id = p_step_id
      AND admission.attempt_id = p_execution_key AND admission.attempt_number = v_subject.attempt_number
      AND admission.capability_id = 'image_generation' AND admission.provider = p_provider
      AND admission.model = p_model AND admission.requested_images = 1
      AND admission.invocation_sequence = 1 AND admission.status = 'admitted'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROVIDER_COST_ADMISSION_REQUIRED';
  END IF;
  SELECT attempt.* INTO v_attempt FROM public.image_generation_attempts AS attempt
  WHERE attempt.id = p_attempt_id AND attempt.user_id = v_subject.user_id
    AND attempt.execution_run_id = p_run_id AND attempt.execution_step_id = p_step_id
    AND attempt.execution_key = p_execution_key AND attempt.execution_claim_id = p_claim_id
    AND attempt.execution_fencing_generation = p_fencing_generation FOR UPDATE;
  IF NOT FOUND OR v_attempt.status <> 'reserved' OR v_attempt.expires_at <= pg_catalog.clock_timestamp()
     OR v_attempt.provider_started_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.image_generation_attempts SET provider = p_provider, model = p_model,
    provider_started_at = pg_catalog.clock_timestamp(), estimated_cost_microusd = 3000
  WHERE id = p_attempt_id AND status = 'reserved';
  RETURN FOUND;
END;
$function$;

CREATE FUNCTION public.release_trusted_image_generation_quota(
  p_run_id uuid, p_step_id text, p_execution_key uuid, p_claim_id uuid, p_fencing_generation bigint,
  p_attempt_id uuid, p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_subject record;
BEGIN
  SELECT * INTO v_subject FROM public.resolve_trusted_agent_execution_subject(
    p_run_id, p_step_id, p_execution_key, p_claim_id, p_fencing_generation
  );
  IF v_subject.capability_id <> 'image_generation' OR p_reason NOT IN
     ('provider_failure','invalid_provider_output','storage_failure','persistence_failure','request_aborted','internal_failure') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGE_QUOTA_RELEASE';
  END IF;
  -- Once provider dispatch started, retain the customer reservation: external
  -- charge outcome cannot be inferred from a failed response.
  UPDATE public.image_generation_attempts SET status = 'released', released_at = pg_catalog.clock_timestamp(), release_reason = p_reason
  WHERE id = p_attempt_id AND user_id = v_subject.user_id AND execution_run_id = p_run_id
    AND execution_step_id = p_step_id AND execution_key = p_execution_key
    AND execution_claim_id = p_claim_id AND execution_fencing_generation = p_fencing_generation
    AND status = 'reserved'
    AND (provider_started_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.agent_provider_cost_admissions AS admission
      WHERE admission.run_id = p_run_id AND admission.step_id = p_step_id
        AND admission.attempt_id = p_execution_key
        AND admission.status IN ('dispatched', 'uncertain')
    ));
  RETURN FOUND;
END;
$function$;

CREATE FUNCTION public.complete_trusted_image_generation(
  p_run_id uuid, p_step_id text, p_execution_key uuid, p_claim_id uuid, p_fencing_generation bigint,
  p_attempt_id uuid, p_content text, p_storage_path text, p_mime_type text, p_provider text, p_model text
)
RETURNS TABLE (user_message_id uuid, assistant_message_id uuid, generated_image_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_subject record;
  v_attempt public.image_generation_attempts%ROWTYPE;
  v_image_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_prefix text;
BEGIN
  SELECT * INTO v_subject FROM public.resolve_trusted_agent_execution_subject(
    p_run_id, p_step_id, p_execution_key, p_claim_id, p_fencing_generation
  );
  IF v_subject.capability_id <> 'image_generation' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EXECUTION_SUBJECT_UNAVAILABLE';
  END IF;
  SELECT attempt.* INTO v_attempt FROM public.image_generation_attempts AS attempt
  WHERE attempt.id = p_attempt_id AND attempt.user_id = v_subject.user_id
    AND attempt.execution_run_id = p_run_id AND attempt.execution_step_id = p_step_id
    AND attempt.execution_key = p_execution_key AND attempt.execution_claim_id = p_claim_id
    AND attempt.execution_fencing_generation = p_fencing_generation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IMAGE_ATTEMPT_UNAVAILABLE'; END IF;
  IF v_attempt.status = 'succeeded' AND v_attempt.generated_image_id IS NOT NULL THEN
    RETURN QUERY SELECT v_subject.user_message_id,v_subject.assistant_message_id,v_attempt.generated_image_id;
    RETURN;
  END IF;
  v_prefix := 'generated/' || v_subject.user_id::text || '/' || v_subject.conversation_id::text || '/';
  IF v_attempt.status <> 'reserved' OR v_attempt.provider_started_at IS NULL OR v_attempt.expires_at <= v_now
     OR p_content IS NULL OR btrim(p_content) = '' OR p_storage_path IS NULL
     OR left(p_storage_path,length(v_prefix)) <> v_prefix OR length(p_storage_path) > 500
     OR position('..' in p_storage_path) > 0 OR position(chr(92) in p_storage_path) > 0
     OR p_storage_path ~ '[[:cntrl:]]' OR p_mime_type NOT IN ('image/webp','image/png','image/jpeg')
     OR p_provider IS DISTINCT FROM v_attempt.provider OR p_model IS DISTINCT FROM v_attempt.model
     OR NOT EXISTS (
       SELECT 1 FROM public.agent_provider_cost_admissions AS admission
       WHERE admission.run_id = p_run_id AND admission.step_id = p_step_id
         AND admission.attempt_id = p_execution_key AND admission.attempt_number = v_subject.attempt_number
         AND admission.capability_id = 'image_generation' AND admission.provider = p_provider
         AND admission.model = p_model AND admission.requested_images = 1
         AND admission.invocation_sequence = 1 AND admission.status IN ('dispatched', 'uncertain', 'settled', 'settled_estimated')
     )
     OR NOT EXISTS (SELECT 1 FROM storage.objects AS object WHERE object.bucket_id='chat-images' AND object.name=p_storage_path) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_IMAGE';
  END IF;
  INSERT INTO public.message_generated_images(message_id,conversation_id,user_id,storage_path,mime_type,provider,model)
  VALUES(v_subject.assistant_message_id,v_subject.conversation_id,v_subject.user_id,p_storage_path,p_mime_type,p_provider,p_model)
  RETURNING id INTO v_image_id;
  UPDATE public.image_generation_attempts SET status='succeeded',completed_at=v_now,generated_image_id=v_image_id
  WHERE id=p_attempt_id AND status='reserved';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_FINALIZATION_FAILED'; END IF;
  UPDATE public.conversations SET updated_at=v_now WHERE id=v_subject.conversation_id AND user_id=v_subject.user_id;
  RETURN QUERY SELECT v_subject.user_message_id,v_subject.assistant_message_id,v_image_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint),
  public.start_trusted_image_generation_attempt(uuid,text,uuid,uuid,bigint,uuid,text,text),
  public.release_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint,uuid,text),
  public.complete_trusted_image_generation(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint),
  public.start_trusted_image_generation_attempt(uuid,text,uuid,uuid,bigint,uuid,text,text),
  public.release_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint,uuid,text),
  public.complete_trusted_image_generation(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,text)
  TO service_role;

CREATE FUNCTION public.persist_trusted_generated_document_for_execution(
  p_run_id uuid, p_step_id text, p_execution_key uuid, p_claim_id uuid, p_fencing_generation bigint,
  p_generated_document_id uuid, p_storage_path text, p_filename text, p_format text,
  p_mime_type text, p_size_bytes bigint, p_template_id text
)
RETURNS TABLE (assistant_message_id uuid, generated_document_id uuid, was_existing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_subject record;
  v_existing public.generated_documents%ROWTYPE;
  v_expected_path text;
  v_mime text;
BEGIN
  SELECT * INTO v_subject FROM public.resolve_trusted_agent_execution_subject(
    p_run_id, p_step_id, p_execution_key, p_claim_id, p_fencing_generation
  );
  IF v_subject.capability_id <> 'document_generation' OR p_generated_document_id IS NULL
     OR p_template_id IS NULL
     OR length(p_template_id) NOT BETWEEN 1 AND 128 OR p_size_bytes NOT BETWEEN 1 AND 10485760
     OR p_format NOT IN ('txt', 'md', 'docx', 'pdf')
     OR p_filename IS NULL OR p_filename <> pg_catalog.btrim(p_filename)
     OR length(p_filename) NOT BETWEEN 1 AND 160 OR position('@' in p_filename) > 0
     OR position('/' in p_filename) > 0 OR position(chr(92) in p_filename) > 0
     OR position('..' in p_filename) > 0 OR p_filename ~ '[[:cntrl:]]'
     OR p_mime_type NOT IN ('text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_DOCUMENT';
  END IF;
  v_mime := CASE p_format WHEN 'txt' THEN 'text/plain' WHEN 'md' THEN 'text/markdown'
    WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ELSE 'application/pdf' END;
  v_expected_path := v_subject.user_id::text || '/' || v_subject.conversation_id::text
    || '/generated/' || p_generated_document_id::text || '/' || p_filename;
  IF p_mime_type <> v_mime OR p_storage_path IS DISTINCT FROM v_expected_path THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_DOCUMENT_PATH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects AS object
    WHERE object.bucket_id = 'documents' AND object.name = p_storage_path) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'GENERATED_DOCUMENT_OBJECT_MISSING';
  END IF;
  PERFORM 1 FROM public.messages AS message WHERE message.id = v_subject.assistant_message_id
    AND message.user_id = v_subject.user_id AND message.conversation_id = v_subject.conversation_id
    AND message.role = 'assistant' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ASSISTANT_MESSAGE_UNAVAILABLE'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_subject.user_id::text || ':' || v_subject.conversation_id::text || ':' || p_execution_key::text, 0));
  SELECT document.* INTO v_existing FROM public.generated_documents AS document
  WHERE document.user_id = v_subject.user_id AND document.conversation_id = v_subject.conversation_id
    AND document.generation_request_id = p_execution_key;
  IF FOUND THEN
    IF v_existing.message_id <> v_subject.assistant_message_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'GENERATED_DOCUMENT_LINKAGE_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_existing.message_id, v_existing.id, true;
    RETURN;
  END IF;
  INSERT INTO public.generated_documents (id,user_id,conversation_id,message_id,generation_request_id,
    storage_path,filename,format,mime_type,size_bytes,template_id)
  VALUES (p_generated_document_id,v_subject.user_id,v_subject.conversation_id,v_subject.assistant_message_id,
    p_execution_key,p_storage_path,p_filename,p_format,p_mime_type,p_size_bytes,p_template_id);
  RETURN QUERY SELECT v_subject.assistant_message_id,p_generated_document_id,false;
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)
  TO service_role;

COMMIT;
