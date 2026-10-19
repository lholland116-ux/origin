BEGIN;

-- Retire the old IP-keyed quota bucket. No client forwarding header is a
-- security identity for this endpoint.
DELETE FROM public.marketing_lead_rate_limits WHERE scope = 'ip';
ALTER TABLE public.marketing_lead_rate_limits
  DROP CONSTRAINT marketing_lead_rate_limits_scope_check;
ALTER TABLE public.marketing_lead_rate_limits
  ADD CONSTRAINT marketing_lead_rate_limits_scope_check CHECK (scope = 'email');
COMMENT ON TABLE public.marketing_lead_rate_limits IS
  'Private HMAC-keyed email rate-limit windows for public marketing lead submissions.';

CREATE TABLE public.marketing_lead_global_rate_limits (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0)
);

INSERT INTO public.marketing_lead_global_rate_limits (singleton, window_started_at, request_count)
VALUES (true, pg_catalog.clock_timestamp(), 0);

ALTER TABLE public.marketing_lead_global_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_lead_global_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_lead_global_rate_limits FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.submit_marketing_lead(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  boolean, text, text, text, text
);

CREATE FUNCTION public.submit_marketing_lead(
  p_lead_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_email_fingerprint text,
  p_name text,
  p_business_email text,
  p_company text,
  p_role text,
  p_workflow_problem text,
  p_interest_type text,
  p_current_process_tools text,
  p_marketing_consent boolean,
  p_source text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing_fingerprint text;
  v_email_started_at timestamptz;
  v_email_count integer;
  v_global_started_at timestamptz;
  v_global_count integer;
BEGIN
  IF p_lead_id IS NULL OR p_idempotency_key IS NULL
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_email_fingerprint IS NULL OR p_email_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120
    OR p_business_email IS NULL OR pg_catalog.char_length(p_business_email) NOT BETWEEN 3 AND 254
    OR p_business_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    OR p_company IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_company)) NOT BETWEEN 1 AND 160
    OR p_role IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_role)) NOT BETWEEN 1 AND 160
    OR p_workflow_problem IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_workflow_problem)) NOT BETWEEN 8 AND 2400
    OR p_interest_type IS NULL OR p_interest_type NOT IN ('early_access', 'demo')
    OR (p_current_process_tools IS NOT NULL AND pg_catalog.char_length(p_current_process_tools) > 1200)
    OR p_marketing_consent IS NULL
    OR p_source IS NULL OR p_source NOT IN ('homepage', 'workflow_automation', 'workflow_preview', 'pricing', 'about', 'faq', 'direct', 'other')
    OR (p_utm_source IS NOT NULL AND pg_catalog.char_length(p_utm_source) > 100)
    OR (p_utm_medium IS NOT NULL AND pg_catalog.char_length(p_utm_medium) > 100)
    OR (p_utm_campaign IS NOT NULL AND pg_catalog.char_length(p_utm_campaign) > 100)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MARKETING_LEAD';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marketing-lead-idempotency:' || p_idempotency_key::text, 0)
  );
  SELECT lead.request_fingerprint INTO v_existing_fingerprint
  FROM public.marketing_leads AS lead
  WHERE lead.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_fingerprint = p_request_fingerprint THEN RETURN 'duplicate'; END IF;
    RETURN 'conflict';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('marketing-lead-email:' || p_email_fingerprint, 0)
  );

  SELECT rate.window_started_at, rate.request_count
    INTO v_global_started_at, v_global_count
  FROM public.marketing_lead_global_rate_limits AS rate
  WHERE rate.singleton
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MARKETING_GLOBAL_LIMIT_UNAVAILABLE';
  END IF;

  SELECT rate.window_started_at, rate.request_count
    INTO v_email_started_at, v_email_count
  FROM public.marketing_lead_rate_limits AS rate
  WHERE rate.scope = 'email' AND rate.fingerprint = p_email_fingerprint
  FOR UPDATE;

  -- Conservative service-wide cap: at most 100 new leads per rolling 24-hour window.
  IF v_global_count >= 100 AND v_global_started_at > v_now - interval '24 hours' THEN RETURN 'rate_limited'; END IF;
  IF v_email_count >= 3 AND v_email_started_at > v_now - interval '24 hours' THEN RETURN 'rate_limited'; END IF;

  INSERT INTO public.marketing_lead_rate_limits (scope, fingerprint, window_started_at, request_count)
  VALUES ('email', p_email_fingerprint, v_now, 1)
  ON CONFLICT (scope, fingerprint) DO UPDATE SET
    window_started_at = CASE WHEN public.marketing_lead_rate_limits.window_started_at <= v_now - interval '24 hours' THEN v_now ELSE public.marketing_lead_rate_limits.window_started_at END,
    request_count = CASE WHEN public.marketing_lead_rate_limits.window_started_at <= v_now - interval '24 hours' THEN 1 ELSE public.marketing_lead_rate_limits.request_count + 1 END;

  UPDATE public.marketing_lead_global_rate_limits
  SET window_started_at = CASE WHEN v_global_started_at <= v_now - interval '24 hours' THEN v_now ELSE v_global_started_at END,
      request_count = CASE WHEN v_global_started_at <= v_now - interval '24 hours' THEN 1 ELSE v_global_count + 1 END
  WHERE singleton;

  INSERT INTO public.marketing_leads (
    lead_id, idempotency_key, request_fingerprint, name, business_email, company, role,
    workflow_problem, interest_type, current_process_tools, marketing_consent,
    marketing_consent_recorded_at, source, utm_source, utm_medium, utm_campaign
  ) VALUES (
    p_lead_id, p_idempotency_key, p_request_fingerprint, pg_catalog.btrim(p_name),
    pg_catalog.lower(pg_catalog.btrim(p_business_email)), pg_catalog.btrim(p_company),
    pg_catalog.btrim(p_role), pg_catalog.btrim(p_workflow_problem), p_interest_type,
    NULLIF(pg_catalog.btrim(p_current_process_tools), ''), p_marketing_consent,
    CASE WHEN p_marketing_consent THEN v_now ELSE NULL END, p_source,
    NULLIF(p_utm_source, ''), NULLIF(p_utm_medium, ''), NULLIF(p_utm_campaign, '')
  );

  -- Bound cleanup work while retaining only recent opaque email fingerprints.
  WITH stale AS (
    SELECT rate.scope, rate.fingerprint
    FROM public.marketing_lead_rate_limits AS rate
    WHERE rate.window_started_at < v_now - interval '30 days'
    ORDER BY rate.window_started_at
    LIMIT 100
  )
  DELETE FROM public.marketing_lead_rate_limits AS rate
  USING stale
  WHERE rate.scope = stale.scope AND rate.fingerprint = stale.fingerprint;

  RETURN 'created';
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_marketing_lead(
  uuid, uuid, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_marketing_lead(
  uuid, uuid, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text
) TO service_role;

COMMENT ON TABLE public.marketing_lead_global_rate_limits IS
  'Private singleton rolling-window cap for new anonymous marketing lead submissions.';
COMMENT ON FUNCTION public.submit_marketing_lead(
  uuid, uuid, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text
) IS
  'Server-only validated and idempotent marketing lead submission with email and global rate limits. No client IP is accepted.';

COMMIT;
