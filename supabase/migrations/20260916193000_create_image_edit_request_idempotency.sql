-- Durable idempotency claims for authenticated image-edit operations.

BEGIN;

CREATE TABLE public.image_edit_requests (
  id                   uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id              uuid                     NOT NULL,
  conversation_id      uuid                     NOT NULL,
  idempotency_key      uuid                     NOT NULL,
  request_fingerprint  text                     NOT NULL,
  status               text                     NOT NULL,
  attempt_id           uuid,
  user_message_id      uuid,
  assistant_message_id uuid,
  generated_image_id   uuid,
  claim_expires_at     timestamp with time zone NOT NULL,
  failure_code         text,
  retry_count          integer                  DEFAULT 0 NOT NULL,
  created_at           timestamp with time zone DEFAULT now() NOT NULL,
  updated_at           timestamp with time zone DEFAULT now() NOT NULL,
  completed_at         timestamp with time zone,
  failed_at            timestamp with time zone,

  CONSTRAINT image_edit_requests_pkey
    PRIMARY KEY (id),

  CONSTRAINT image_edit_requests_user_id_idempotency_key_key
    UNIQUE (user_id, idempotency_key),

  CONSTRAINT image_edit_requests_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users (id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,

  CONSTRAINT image_edit_requests_conversation_id_fkey
    FOREIGN KEY (conversation_id)
    REFERENCES public.conversations (id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,

  CONSTRAINT image_edit_requests_attempt_id_fkey
    FOREIGN KEY (attempt_id)
    REFERENCES public.image_generation_attempts (id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,

  CONSTRAINT image_edit_requests_user_message_id_fkey
    FOREIGN KEY (user_message_id)
    REFERENCES public.messages (id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,

  CONSTRAINT image_edit_requests_assistant_message_id_fkey
    FOREIGN KEY (assistant_message_id)
    REFERENCES public.messages (id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,

  CONSTRAINT image_edit_requests_generated_image_id_fkey
    FOREIGN KEY (generated_image_id)
    REFERENCES public.message_generated_images (id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED,

  CONSTRAINT image_edit_requests_status_check
    CHECK (status IN ('in_progress', 'failed', 'completed')),

  CONSTRAINT image_edit_requests_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),

  CONSTRAINT image_edit_requests_retry_count_check
    CHECK (retry_count >= 0),

  CONSTRAINT image_edit_requests_claim_lease_check
    CHECK (
      status <> 'in_progress'
      OR claim_expires_at > updated_at
    ),

  CONSTRAINT image_edit_requests_failure_code_check
    CHECK (
      failure_code IS NULL
      OR failure_code IN (
        'invalid_request',
        'source_not_found',
        'source_forbidden',
        'quota_reservation_failed',
        'attempt_start_failed',
        'provider_configuration',
        'provider_timeout',
        'provider_failure',
        'invalid_provider_output',
        'storage_failure',
        'persistence_failure',
        'request_aborted',
        'internal_failure'
      )
    ),

  CONSTRAINT image_edit_requests_lifecycle_check
    CHECK (
      (
        status = 'in_progress'
        AND failure_code IS NULL
        AND completed_at IS NULL
        AND failed_at IS NULL
      )
      OR (
        status = 'failed'
        AND failure_code IS NOT NULL
        AND completed_at IS NULL
        AND failed_at IS NOT NULL
      )
      OR (
        status = 'completed'
        AND failure_code IS NULL
        AND completed_at IS NOT NULL
        AND failed_at IS NULL
      )
    )
);

CREATE INDEX image_edit_requests_attempt_id_idx
  ON public.image_edit_requests (attempt_id)
  WHERE attempt_id IS NOT NULL;

CREATE INDEX image_edit_requests_expired_in_progress_idx
  ON public.image_edit_requests (claim_expires_at)
  WHERE status = 'in_progress';

ALTER TABLE public.image_edit_requests
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.image_edit_requests
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.image_edit_requests
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.image_edit_requests
TO service_role;

COMMENT ON TABLE public.image_edit_requests IS
  'Server-controlled idempotency claims for authenticated image-edit operations.';

COMMENT ON COLUMN public.image_edit_requests.idempotency_key IS
  'Explicit client operation key; uniqueness is scoped to the authenticated user.';

COMMENT ON COLUMN public.image_edit_requests.request_fingerprint IS
  'Lowercase hexadecimal SHA-256 digest of the canonical image-edit request.';

-- CS5C-1B must build this digest from conversationId, the normalized
-- ImageEditSourceReference, and the exact validated instruction only. The
-- authenticated user, storage path, MIME, dimensions, provider, model, and
-- endpoint are intentionally outside the canonical fingerprint.

COMMENT ON COLUMN public.image_edit_requests.claim_expires_at IS
  'The end of the fixed fifteen-minute claim lease used for crash recovery.';

-- Claim a new operation or safely replay/reclaim the existing operation for
-- the authenticated user. Provider execution and final completion remain
-- outside this foundation migration.
CREATE OR REPLACE FUNCTION public.claim_image_edit_request(
  p_conversation_id     uuid,
  p_idempotency_key     uuid,
  p_request_fingerprint text
)
RETURNS TABLE (
  image_edit_request_id uuid,
  disposition           text,
  attempt_id            uuid,
  stale_attempt_id      uuid,
  user_message_id       uuid,
  assistant_message_id  uuid,
  generated_image_id    uuid,
  status                text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id       uuid;
  v_now           timestamp with time zone := clock_timestamp();
  v_claim_expires timestamp with time zone;
  v_inserted_id   uuid;
  v_existing      public.image_edit_requests%ROWTYPE;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF p_conversation_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGE_EDIT_REQUEST';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations
    WHERE id = p_conversation_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  v_claim_expires := v_now + interval '15 minutes';

  INSERT INTO public.image_edit_requests (
    user_id,
    conversation_id,
    idempotency_key,
    request_fingerprint,
    status,
    claim_expires_at
  )
  VALUES (
    v_user_id,
    p_conversation_id,
    p_idempotency_key,
    p_request_fingerprint,
    'in_progress',
    v_claim_expires
  )
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      v_inserted_id,
      'claimed'::text,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      'in_progress'::text;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.image_edit_requests
  WHERE user_id = v_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_EDIT_REQUEST_UNAVAILABLE';
  END IF;

  IF v_existing.conversation_id IS DISTINCT FROM p_conversation_id
     OR v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint
  THEN
    RETURN QUERY
    SELECT
      v_existing.id,
      'conflict'::text,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      v_existing.status;
    RETURN;
  END IF;

  IF v_existing.status = 'completed' THEN
    RETURN QUERY
    SELECT
      v_existing.id,
      'completed'::text,
      v_existing.attempt_id,
      NULL::uuid,
      v_existing.user_message_id,
      v_existing.assistant_message_id,
      v_existing.generated_image_id,
      v_existing.status;
    RETURN;
  END IF;

  IF v_existing.status = 'in_progress'
     AND v_existing.claim_expires_at > v_now
  THEN
    RETURN QUERY
    SELECT
      v_existing.id,
      'in_progress'::text,
      v_existing.attempt_id,
      NULL::uuid,
      v_existing.user_message_id,
      v_existing.assistant_message_id,
      v_existing.generated_image_id,
      v_existing.status;
    RETURN;
  END IF;

  IF v_existing.status = 'failed'
     OR (v_existing.status = 'in_progress' AND v_existing.claim_expires_at <= v_now)
  THEN
    UPDATE public.image_edit_requests
    SET
      status = 'in_progress',
      claim_expires_at = v_claim_expires,
      failure_code = NULL,
      retry_count = retry_count + 1,
      user_message_id = NULL,
      assistant_message_id = NULL,
      generated_image_id = NULL,
      completed_at = NULL,
      failed_at = NULL,
      updated_at = v_now
    WHERE id = v_existing.id
      AND user_id = v_user_id;

    RETURN QUERY
    SELECT
      v_existing.id,
      'claimed'::text,
      NULL::uuid,
      v_existing.attempt_id,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      'in_progress'::text;
    RETURN;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_EDIT_REQUEST_UNAVAILABLE';
END;
$function$;

-- Bind exactly one active, same-conversation image-generation attempt to an
-- in-progress image-edit claim. Quota release remains a separate operation.
CREATE OR REPLACE FUNCTION public.bind_image_edit_request_attempt(
  p_image_edit_request_id uuid,
  p_attempt_id            uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id                 uuid;
  v_now                     timestamp with time zone := clock_timestamp();
  v_request_conversation_id uuid;
  v_request_status          text;
  v_request_expires_at      timestamp with time zone;
  v_existing_attempt_id     uuid;
  v_attempt_conversation_id uuid;
  v_attempt_status          text;
  v_attempt_expires_at      timestamp with time zone;
  v_existing_attempt_status text;
  v_existing_attempt_expires_at timestamp with time zone;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF p_image_edit_request_id IS NULL OR p_attempt_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT
    conversation_id,
    status,
    claim_expires_at,
    attempt_id
  INTO
    v_request_conversation_id,
    v_request_status,
    v_request_expires_at,
    v_existing_attempt_id
  FROM public.image_edit_requests
  WHERE id = p_image_edit_request_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_request_status <> 'in_progress'
     OR v_request_expires_at <= v_now
  THEN
    RETURN false;
  END IF;

  SELECT
    conversation_id,
    status,
    expires_at
  INTO
    v_attempt_conversation_id,
    v_attempt_status,
    v_attempt_expires_at
  FROM public.image_generation_attempts
  WHERE id = p_attempt_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_attempt_conversation_id IS DISTINCT FROM v_request_conversation_id
     OR v_attempt_status <> 'reserved'
     OR v_attempt_expires_at <= v_now
  THEN
    RETURN false;
  END IF;

  IF v_existing_attempt_id IS NOT NULL
     AND v_existing_attempt_id IS DISTINCT FROM p_attempt_id
  THEN
    SELECT
      status,
      expires_at
    INTO
      v_existing_attempt_status,
      v_existing_attempt_expires_at
    FROM public.image_generation_attempts
    WHERE id = v_existing_attempt_id
      AND user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN false;
    END IF;

    IF v_existing_attempt_status NOT IN ('reserved', 'succeeded', 'released')
       OR (
         v_existing_attempt_status = 'reserved'
         AND v_existing_attempt_expires_at > v_now
       )
    THEN
      RETURN false;
    END IF;
  END IF;

  IF v_existing_attempt_id IS NULL THEN
    UPDATE public.image_edit_requests
    SET
      attempt_id = p_attempt_id,
      updated_at = v_now
    WHERE id = p_image_edit_request_id
      AND user_id = v_user_id
      AND attempt_id IS NULL;
  ELSIF v_existing_attempt_id IS DISTINCT FROM p_attempt_id THEN
    UPDATE public.image_edit_requests
    SET
      attempt_id = p_attempt_id,
      updated_at = v_now
    WHERE id = p_image_edit_request_id
      AND user_id = v_user_id
      AND attempt_id = v_existing_attempt_id;
  END IF;

  RETURN true;
END;
$function$;

-- Mark an active claim failed with a bounded application error code. This
-- intentionally does not release the separately tracked image quota attempt.
CREATE OR REPLACE FUNCTION public.fail_image_edit_request(
  p_image_edit_request_id uuid,
  p_failure_code          text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id            uuid;
  v_now                timestamp with time zone := clock_timestamp();
  v_status             text;
  v_claim_expires_at   timestamp with time zone;
  v_failure_code       text := btrim(p_failure_code);
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF v_failure_code IS NULL
     OR v_failure_code NOT IN (
       'invalid_request',
       'source_not_found',
       'source_forbidden',
       'quota_reservation_failed',
       'attempt_start_failed',
       'provider_configuration',
       'provider_timeout',
       'provider_failure',
       'invalid_provider_output',
       'storage_failure',
       'persistence_failure',
       'request_aborted',
       'internal_failure'
     )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGE_EDIT_FAILURE_CODE';
  END IF;

  IF p_image_edit_request_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT status, claim_expires_at
  INTO v_status, v_claim_expires_at
  FROM public.image_edit_requests
  WHERE id = p_image_edit_request_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_status <> 'in_progress'
     OR v_claim_expires_at <= v_now
  THEN
    RETURN false;
  END IF;

  UPDATE public.image_edit_requests
  SET
    status = 'failed',
    failure_code = v_failure_code,
    updated_at = v_now,
    failed_at = v_now
  WHERE id = p_image_edit_request_id
    AND user_id = v_user_id
    AND status = 'in_progress';

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_image_edit_request(uuid, uuid, text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_image_edit_request(uuid, uuid, text)
TO authenticated;

REVOKE ALL ON FUNCTION public.bind_image_edit_request_attempt(uuid, uuid)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.bind_image_edit_request_attempt(uuid, uuid)
TO authenticated;

REVOKE ALL ON FUNCTION public.fail_image_edit_request(uuid, text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fail_image_edit_request(uuid, text)
TO authenticated;

COMMIT;
