-- Replace the pre-idempotency image-edit completion function with the one
-- authoritative, request-bound finalizer.

BEGIN;

REVOKE ALL ON FUNCTION public.complete_generated_image_edit(
  uuid, uuid, text, text, text, text, text, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.complete_generated_image_edit(
  uuid, uuid, text, text, text, text, text, uuid, uuid, integer
);

DROP FUNCTION IF EXISTS public.complete_generated_image_edit(
  uuid, text, uuid, uuid, text, text, text, text, text, uuid, uuid, integer
);

CREATE FUNCTION public.complete_generated_image_edit(
  p_authenticated_user_id     uuid,
  p_image_edit_request_id     uuid,
  p_request_fingerprint       text,
  p_attempt_id                uuid,
  p_conversation_id           uuid,
  p_instruction               text,
  p_storage_path              text,
  p_mime_type                 text,
  p_provider                  text,
  p_model                     text,
  p_source_generated_image_id uuid,
  p_source_uploaded_message_id uuid,
  p_source_uploaded_ordinal   integer
)
RETURNS TABLE (
  user_message_id      uuid,
  assistant_message_id uuid,
  generated_image_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id                    uuid;
  v_request_now               timestamp with time zone;
  v_attempt_now               timestamp with time zone;
  v_completion_now            timestamp with time zone;
  v_prefix                    text;
  v_provider                  text := btrim(p_provider);
  v_model                     text := btrim(p_model);
  v_request_user_id           uuid;
  v_request_conversation_id   uuid;
  v_request_fingerprint       text;
  v_request_status            text;
  v_request_claim_expires_at  timestamp with time zone;
  v_request_attempt_id        uuid;
  v_request_user_message_id   uuid;
  v_request_assistant_message_id uuid;
  v_request_generated_image_id uuid;
  v_attempt_user_id           uuid;
  v_attempt_conversation_id   uuid;
  v_attempt_status            text;
  v_attempt_expires_at        timestamp with time zone;
  v_attempt_provider_started_at timestamp with time zone;
  v_attempt_provider          text;
  v_attempt_model             text;
  v_conversation_id           uuid;
  v_source_generated_id       uuid;
  v_source_uploaded_message_id uuid;
  v_source_uploaded_ordinal   integer;
  v_user_message_id           uuid;
  v_assistant_message_id      uuid;
  v_generated_image_id        uuid;
BEGIN
  v_user_id := p_authenticated_user_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  -- Lock the request before the attempt. This prevents an expired worker from
  -- finalizing after a later worker has reclaimed and rebound the request.
  SELECT
    request_row.user_id,
    request_row.conversation_id,
    request_row.request_fingerprint,
    request_row.status,
    request_row.claim_expires_at,
    request_row.attempt_id,
    request_row.user_message_id,
    request_row.assistant_message_id,
    request_row.generated_image_id
  INTO
    v_request_user_id,
    v_request_conversation_id,
    v_request_fingerprint,
    v_request_status,
    v_request_claim_expires_at,
    v_request_attempt_id,
    v_request_user_message_id,
    v_request_assistant_message_id,
    v_request_generated_image_id
  FROM public.image_edit_requests AS request_row
  WHERE request_row.id = p_image_edit_request_id
  FOR UPDATE;

  v_request_now := clock_timestamp();

  IF NOT FOUND
     OR v_request_user_id IS DISTINCT FROM v_user_id
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_EDIT_REQUEST_UNAVAILABLE';
  END IF;

  IF v_request_conversation_id IS DISTINCT FROM p_conversation_id
     OR v_request_fingerprint IS DISTINCT FROM p_request_fingerprint
     OR v_request_status <> 'in_progress'
     OR v_request_claim_expires_at <= v_request_now
     OR v_request_attempt_id IS DISTINCT FROM p_attempt_id
     OR v_request_user_message_id IS NOT NULL
     OR v_request_assistant_message_id IS NOT NULL
     OR v_request_generated_image_id IS NOT NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_EDIT_REQUEST_UNAVAILABLE';
  END IF;

  IF p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGE_EDIT_REQUEST';
  END IF;

  -- The attempt is deliberately locked only after its request has been
  -- locked, preserving the request -> attempt lock order for all workers.
  SELECT
    user_id,
    conversation_id,
    status,
    expires_at,
    provider_started_at,
    provider,
    model
  INTO
    v_attempt_user_id,
    v_attempt_conversation_id,
    v_attempt_status,
    v_attempt_expires_at,
    v_attempt_provider_started_at,
    v_attempt_provider,
    v_attempt_model
  FROM public.image_generation_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  v_attempt_now := clock_timestamp();

  IF NOT FOUND
     OR v_attempt_user_id IS DISTINCT FROM v_user_id
     OR v_attempt_conversation_id IS DISTINCT FROM p_conversation_id
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_NOT_FOUND';
  END IF;

  IF v_attempt_status <> 'reserved' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_NOT_RESERVED';
  END IF;

  IF v_attempt_expires_at <= v_attempt_now THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_RESERVATION_EXPIRED';
  END IF;

  IF v_attempt_provider_started_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_PROVIDER_NOT_STARTED';
  END IF;

  IF p_instruction IS NULL
     OR btrim(p_instruction) = ''
     OR char_length(p_instruction) > 4000
     OR p_storage_path IS NULL
     OR p_mime_type IS DISTINCT FROM 'image/png'
     OR v_provider IS NULL
     OR v_provider = ''
     OR length(v_provider) > 100
     OR v_provider !~ '^[a-zA-Z0-9._:/-]+$'
     OR v_model IS NULL
     OR v_model = ''
     OR length(v_model) > 100
     OR v_model !~ '^[a-zA-Z0-9._:/@-]+$'
     OR v_provider IS DISTINCT FROM 'runware'
     OR v_model IS DISTINCT FROM 'runware:400@4'
     OR v_attempt_provider IS DISTINCT FROM v_provider
     OR v_attempt_model IS DISTINCT FROM v_model
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_IMAGE_EDIT';
  END IF;

  v_prefix := 'generated/' || v_user_id::text || '/' || p_conversation_id::text || '/';

  IF left(p_storage_path, length(v_prefix)) <> v_prefix
     OR length(p_storage_path) > 500
     OR position('..' in p_storage_path) > 0
     OR position(chr(92) in p_storage_path) > 0
     OR p_storage_path ~ '[[:cntrl:]]'
     OR p_storage_path !~ (
       '^' || v_prefix ||
       '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]png$'
     )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_IMAGE_EDIT';
  END IF;

  IF (
       p_source_generated_image_id IS NOT NULL
       AND (p_source_uploaded_message_id IS NOT NULL OR p_source_uploaded_ordinal IS NOT NULL)
     )
     OR (
       p_source_generated_image_id IS NULL
       AND (p_source_uploaded_message_id IS NULL OR p_source_uploaded_ordinal IS NULL)
     )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGE_EDIT_SOURCE';
  END IF;

  SELECT id
  INTO v_conversation_id
  FROM public.conversations
  WHERE id = p_conversation_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  IF p_source_generated_image_id IS NOT NULL THEN
    SELECT
      source_image.id,
      source_message.id
    INTO
      v_source_generated_id,
      v_source_uploaded_message_id
    FROM public.message_generated_images AS source_image
    JOIN public.messages AS source_message
      ON source_message.id = source_image.message_id
    WHERE source_image.id = p_source_generated_image_id
      AND source_image.user_id = v_user_id
      AND source_image.conversation_id = p_conversation_id
      AND source_message.user_id = v_user_id
      AND source_message.conversation_id = p_conversation_id
      AND source_message.role = 'assistant'
    FOR KEY SHARE OF source_image, source_message;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_SOURCE_NOT_FOUND';
    END IF;
  ELSE
    IF p_source_uploaded_ordinal < 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGE_EDIT_SOURCE';
    END IF;

    SELECT source_message.id
    INTO v_source_uploaded_message_id
    FROM public.messages AS source_message
    WHERE source_message.id = p_source_uploaded_message_id
      AND source_message.user_id = v_user_id
      AND source_message.conversation_id = p_conversation_id
      AND source_message.role = 'user'
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_SOURCE_NOT_FOUND';
    END IF;

    SELECT source_image.message_id, source_image.ordinal
    INTO v_source_uploaded_message_id, v_source_uploaded_ordinal
    FROM public.message_images AS source_image
    WHERE source_image.message_id = p_source_uploaded_message_id
      AND source_image.ordinal = p_source_uploaded_ordinal
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_SOURCE_NOT_FOUND';
    END IF;
  END IF;

  -- Storage existence is checked against the authoritative catalog after the
  -- application/source rows, preserving the deterministic lock order.
  PERFORM 1
  FROM storage.objects AS derivative_object
  WHERE derivative_object.bucket_id = 'chat-images'
    AND derivative_object.name = p_storage_path
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_STORAGE_OBJECT_NOT_FOUND';
  END IF;

  v_completion_now := clock_timestamp();

  INSERT INTO public.messages (
    conversation_id,
    user_id,
    role,
    content,
    documents
  )
  VALUES (
    p_conversation_id,
    v_user_id,
    'user',
    p_instruction,
    '[]'::jsonb
  )
  RETURNING id INTO v_user_message_id;

  INSERT INTO public.messages (
    conversation_id,
    user_id,
    role,
    content,
    documents
  )
  VALUES (
    p_conversation_id,
    v_user_id,
    'assistant',
    '',
    '[]'::jsonb
  )
  RETURNING id INTO v_assistant_message_id;

  INSERT INTO public.message_generated_images (
    message_id,
    conversation_id,
    user_id,
    storage_path,
    mime_type,
    provider,
    model
  )
  VALUES (
    v_assistant_message_id,
    p_conversation_id,
    v_user_id,
    p_storage_path,
    p_mime_type,
    v_provider,
    v_model
  )
  RETURNING id INTO v_generated_image_id;

  INSERT INTO public.image_edit_lineage (
    derivative_generated_image_id,
    operation,
    source_generated_image_id,
    source_uploaded_message_id,
    source_uploaded_ordinal,
    instruction
  )
  VALUES (
    v_generated_image_id,
    'edit',
    p_source_generated_image_id,
    p_source_uploaded_message_id,
    p_source_uploaded_ordinal,
    p_instruction
  );

  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = p_conversation_id
    AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  UPDATE public.image_generation_attempts
  SET
    status = 'succeeded',
    completed_at = v_completion_now
  WHERE id = p_attempt_id
    AND user_id = v_user_id
    AND status = 'reserved';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_FINALIZATION_FAILED';
  END IF;

  UPDATE public.image_edit_requests
  SET
    status = 'completed',
    failure_code = NULL,
    completed_at = v_completion_now,
    failed_at = NULL,
    attempt_id = p_attempt_id,
    user_message_id = v_user_message_id,
    assistant_message_id = v_assistant_message_id,
    generated_image_id = v_generated_image_id,
    updated_at = v_completion_now
  WHERE id = p_image_edit_request_id
    AND user_id = v_user_id
    AND status = 'in_progress'
    AND attempt_id = p_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_EDIT_REQUEST_FINALIZATION_FAILED';
  END IF;

  RETURN QUERY
  SELECT v_user_message_id, v_assistant_message_id, v_generated_image_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_generated_image_edit(
  uuid, uuid, text, uuid, uuid, text, text, text, text, text, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.complete_generated_image_edit(
  uuid, uuid, text, uuid, uuid, text, text, text, text, text, uuid, uuid, integer
) TO service_role;

COMMIT;
