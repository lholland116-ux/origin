BEGIN;

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

  v_daily_limit := CASE WHEN v_plan = 'pro' THEN 20 ELSE 3 END;
  v_monthly_limit := CASE WHEN v_plan = 'pro' THEN 200 ELSE 21 END;
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

REVOKE ALL ON FUNCTION public.reserve_image_generation_quota(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_image_generation_quota(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_image_generation_quota(uuid) TO authenticated;

COMMIT;
