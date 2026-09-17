-- Allow the qualified Runware model identifier used by image editing.

BEGIN;

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
     OR v_model !~ '^[a-zA-Z0-9._:/+@-]+$'
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

COMMIT;
