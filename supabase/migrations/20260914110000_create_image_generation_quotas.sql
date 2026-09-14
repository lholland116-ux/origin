BEGIN;

CREATE TABLE public.image_generation_attempts (
  id                       uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id                  uuid                     NOT NULL,
  conversation_id          uuid                     NOT NULL,
  plan_snapshot            text                     NOT NULL,
  status                   text                     DEFAULT 'reserved'::text NOT NULL,
  reserved_at              timestamp with time zone DEFAULT now() NOT NULL,
  expires_at               timestamp with time zone NOT NULL,
  provider_started_at      timestamp with time zone,
  completed_at             timestamp with time zone,
  released_at              timestamp with time zone,
  release_reason           text,
  provider                 text,
  model                    text,
  estimated_cost_microusd  bigint
);

ALTER TABLE public.image_generation_attempts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_pkey PRIMARY KEY (id);

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_plan_check
    CHECK (plan_snapshot IN ('free', 'pro'));

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_status_check
    CHECK (status IN ('reserved', 'succeeded', 'released'));

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_release_reason_check
    CHECK (
      release_reason IS NULL
      OR release_reason IN (
        'provider_failure',
        'invalid_provider_output',
        'storage_failure',
        'persistence_failure',
        'request_aborted',
        'internal_failure',
        'expired'
      )
    );

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_cost_check
    CHECK (estimated_cost_microusd IS NULL OR estimated_cost_microusd >= 0);

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_expiry_check
    CHECK (expires_at > reserved_at);

ALTER TABLE public.image_generation_attempts
  ADD CONSTRAINT image_generation_attempts_lifecycle_check
    CHECK (
      (
        status = 'reserved'
        AND completed_at IS NULL
        AND released_at IS NULL
        AND release_reason IS NULL
      )
      OR (
        status = 'succeeded'
        AND completed_at IS NOT NULL
        AND released_at IS NULL
        AND release_reason IS NULL
      )
      OR (
        status = 'released'
        AND completed_at IS NULL
        AND released_at IS NOT NULL
        AND release_reason IS NOT NULL
      )
    );

CREATE INDEX image_generation_attempts_user_status_reserved_idx
  ON public.image_generation_attempts (user_id, status, reserved_at);

CREATE INDEX image_generation_attempts_user_completed_idx
  ON public.image_generation_attempts (user_id, completed_at);

CREATE INDEX image_generation_attempts_conversation_idx
  ON public.image_generation_attempts (conversation_id);

REVOKE ALL ON public.image_generation_attempts FROM PUBLIC;
REVOKE ALL ON public.image_generation_attempts FROM anon;
REVOKE ALL ON public.image_generation_attempts FROM authenticated;
GRANT SELECT ON public.image_generation_attempts TO authenticated;
GRANT ALL ON public.image_generation_attempts TO service_role;

CREATE POLICY "Users can view own image-generation attempts"
  ON public.image_generation_attempts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.image_generation_attempts IS
  'Server-controlled image-generation quota reservations and operational telemetry.';

CREATE OR REPLACE FUNCTION public.reserve_image_generation_quota(
  p_conversation_id uuid
)
RETURNS TABLE (
  attempt_id       uuid,
  plan             text,
  daily_used       bigint,
  daily_reserved   bigint,
  daily_limit      integer,
  daily_remaining  bigint,
  monthly_used     bigint,
  monthly_reserved bigint,
  monthly_limit    integer,
  monthly_remaining bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_plan text;
  v_now timestamp with time zone := clock_timestamp();
  v_utc_now timestamp without time zone := clock_timestamp() AT TIME ZONE 'UTC';
  v_day_start timestamp with time zone;
  v_month_start timestamp with time zone;
  v_daily_limit integer;
  v_monthly_limit integer;
  v_daily_used bigint;
  v_daily_reserved bigint;
  v_monthly_used bigint;
  v_monthly_reserved bigint;
  v_attempt_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
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

  SELECT p.plan
  INTO v_plan
  FROM public.profiles AS p
  WHERE p.id = v_user_id
  FOR SHARE;

  IF NOT FOUND OR v_plan IS NULL OR v_plan NOT IN ('free', 'pro') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_PLAN_UNAVAILABLE';
  END IF;

  v_daily_limit := CASE WHEN v_plan = 'pro' THEN 20 ELSE 2 END;
  v_monthly_limit := CASE WHEN v_plan = 'pro' THEN 200 ELSE 10 END;
  v_day_start := ((v_utc_now::date)::timestamp without time zone AT TIME ZONE 'UTC');
  v_month_start := (
    (date_trunc('month', v_utc_now)::date)::timestamp without time zone
    AT TIME ZONE 'UTC'
  );

  UPDATE public.image_generation_attempts
  SET
    status = 'released',
    released_at = v_now,
    release_reason = 'expired'
  WHERE user_id = v_user_id
    AND status = 'reserved'
    AND expires_at <= v_now;

  SELECT
    count(*) FILTER (
      WHERE status = 'succeeded'
        AND completed_at >= v_day_start
    ),
    count(*) FILTER (
      WHERE status = 'reserved'
        AND expires_at > v_now
    ),
    count(*) FILTER (
      WHERE status = 'succeeded'
        AND completed_at >= v_month_start
    ),
    count(*) FILTER (
      WHERE status = 'reserved'
        AND expires_at > v_now
    )
  INTO
    v_daily_used,
    v_daily_reserved,
    v_monthly_used,
    v_monthly_reserved
  FROM public.image_generation_attempts
  WHERE user_id = v_user_id;

  IF v_daily_used + v_daily_reserved >= v_daily_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_DAILY_LIMIT_REACHED';
  END IF;

  IF v_monthly_used + v_monthly_reserved >= v_monthly_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_MONTHLY_LIMIT_REACHED';
  END IF;

  INSERT INTO public.image_generation_attempts (
    user_id,
    conversation_id,
    plan_snapshot,
    status,
    reserved_at,
    expires_at
  )
  VALUES (
    v_user_id,
    p_conversation_id,
    v_plan,
    'reserved',
    v_now,
    v_now + interval '15 minutes'
  )
  RETURNING id INTO v_attempt_id;

  RETURN QUERY
  SELECT
    v_attempt_id,
    v_plan,
    v_daily_used,
    v_daily_reserved + 1,
    v_daily_limit,
    GREATEST(v_daily_limit::bigint - v_daily_used - v_daily_reserved - 1, 0),
    v_monthly_used,
    v_monthly_reserved + 1,
    v_monthly_limit,
    GREATEST(v_monthly_limit::bigint - v_monthly_used - v_monthly_reserved - 1, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_image_generation_attempt(
  p_attempt_id uuid,
  p_provider   text,
  p_model      text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_status text;
  v_provider_started_at timestamp with time zone;
  v_expires_at timestamp with time zone;
  v_provider text := btrim(p_provider);
  v_model text := btrim(p_model);
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF p_attempt_id IS NULL
     OR v_provider IS NULL
     OR v_provider = ''
     OR length(v_provider) > 100
     OR v_provider !~ '^[a-zA-Z0-9._:/-]+$'
     OR v_model IS NULL
     OR v_model = ''
     OR length(v_model) > 100
     OR v_model !~ '^[a-zA-Z0-9._:/-]+$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PROVIDER_METADATA';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT
    status,
    provider_started_at,
    expires_at
  INTO
    v_status,
    v_provider_started_at,
    v_expires_at
  FROM public.image_generation_attempts
  WHERE id = p_attempt_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'reserved' THEN
    RETURN false;
  END IF;

  IF v_expires_at <= v_now THEN
    UPDATE public.image_generation_attempts
    SET
      status = 'released',
      released_at = v_now,
      release_reason = 'expired'
    WHERE id = p_attempt_id
      AND user_id = v_user_id
      AND status = 'reserved';
    RETURN false;
  END IF;

  IF v_provider_started_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.image_generation_attempts
  SET
    provider = v_provider,
    model = v_model,
    provider_started_at = v_now,
    estimated_cost_microusd = CASE
      WHEN v_provider = 'replicate' AND v_model = 'flux-schnell' THEN 3000
      ELSE NULL
    END
  WHERE id = p_attempt_id
    AND user_id = v_user_id
    AND status = 'reserved';

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_image_generation_quota(
  p_attempt_id uuid,
  p_reason     text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_status text;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'provider_failure',
    'invalid_provider_output',
    'storage_failure',
    'persistence_failure',
    'request_aborted',
    'internal_failure',
    'expired'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_RELEASE_REASON';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT status
  INTO v_status
  FROM public.image_generation_attempts
  WHERE id = p_attempt_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'reserved' THEN
    RETURN false;
  END IF;

  UPDATE public.image_generation_attempts
  SET
    status = 'released',
    released_at = v_now,
    release_reason = p_reason
  WHERE id = p_attempt_id
    AND user_id = v_user_id
    AND status = 'reserved';

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_generated_image_generation(
  p_attempt_id      uuid,
  p_conversation_id uuid,
  p_content         text,
  p_storage_path    text,
  p_mime_type       text,
  p_provider        text,
  p_model           text
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
  v_user_id uuid;
  v_status text;
  v_attempt_conversation_id uuid;
  v_expires_at timestamp with time zone;
  v_provider_started_at timestamp with time zone;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_generated_image_id uuid;
  v_prefix text;
  v_provider text := btrim(p_provider);
  v_model text := btrim(p_model);
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT
    status,
    conversation_id,
    expires_at,
    provider_started_at
  INTO
    v_status,
    v_attempt_conversation_id,
    v_expires_at,
    v_provider_started_at
  FROM public.image_generation_attempts
  WHERE id = p_attempt_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_NOT_FOUND';
  END IF;

  IF v_attempt_conversation_id IS DISTINCT FROM p_conversation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_CONVERSATION_MISMATCH';
  END IF;

  IF v_status <> 'reserved' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_NOT_RESERVED';
  END IF;

  IF v_expires_at <= v_now THEN
    UPDATE public.image_generation_attempts
    SET
      status = 'released',
      released_at = v_now,
      release_reason = 'expired'
    WHERE id = p_attempt_id
      AND user_id = v_user_id
      AND status = 'reserved';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_RESERVATION_EXPIRED';
  END IF;

  IF v_provider_started_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_PROVIDER_NOT_STARTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations
    WHERE id = p_conversation_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  v_prefix := 'generated/' || v_user_id::text || '/' || p_conversation_id::text || '/';

  IF p_content IS NULL OR btrim(p_content) = ''
     OR p_storage_path IS NULL
     OR left(p_storage_path, length(v_prefix)) <> v_prefix
     OR length(p_storage_path) > 500
     OR position('..' in p_storage_path) > 0
     OR position(chr(92) in p_storage_path) > 0
     OR p_storage_path ~ '[[:cntrl:]]'
     OR p_mime_type NOT IN ('image/webp', 'image/png', 'image/jpeg')
     OR v_provider IS NULL OR v_provider = '' OR length(v_provider) > 100
     OR v_provider !~ '^[a-zA-Z0-9._:/-]+$'
     OR v_model IS NULL OR v_model = '' OR length(v_model) > 100
     OR v_model !~ '^[a-zA-Z0-9._:/-]+$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_IMAGE';
  END IF;

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
    p_content,
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

  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = p_conversation_id
    AND user_id = v_user_id;

  UPDATE public.image_generation_attempts
  SET
    status = 'succeeded',
    completed_at = v_now
  WHERE id = p_attempt_id
    AND user_id = v_user_id
    AND status = 'reserved';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_FINALIZATION_FAILED';
  END IF;

  RETURN QUERY
  SELECT v_user_message_id, v_assistant_message_id, v_generated_image_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_image_generation_quota(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_image_generation_quota(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_image_generation_quota(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.start_image_generation_attempt(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_image_generation_attempt(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_image_generation_attempt(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.release_image_generation_quota(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_image_generation_quota(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_image_generation_quota(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_generated_image_generation(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_generated_image_generation(uuid, uuid, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_generated_image_generation(uuid, uuid, text, text, text, text, text) TO authenticated;

COMMIT;
