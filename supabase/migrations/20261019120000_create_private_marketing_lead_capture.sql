BEGIN;

CREATE TABLE public.marketing_leads (
  lead_id uuid PRIMARY KEY,
  idempotency_key uuid NOT NULL UNIQUE,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  business_email text NOT NULL CHECK (char_length(business_email) BETWEEN 3 AND 254),
  company text NOT NULL CHECK (char_length(company) BETWEEN 1 AND 160),
  role text NOT NULL CHECK (char_length(role) BETWEEN 1 AND 160),
  workflow_problem text NOT NULL CHECK (char_length(workflow_problem) BETWEEN 8 AND 2400),
  interest_type text NOT NULL CHECK (interest_type IN ('early_access', 'demo')),
  current_process_tools text CHECK (current_process_tools IS NULL OR char_length(current_process_tools) <= 1200),
  marketing_consent boolean NOT NULL DEFAULT false,
  marketing_consent_recorded_at timestamptz,
  source text NOT NULL CHECK (source IN ('homepage', 'workflow_automation', 'workflow_preview', 'pricing', 'about', 'faq', 'direct', 'other')),
  utm_source text CHECK (utm_source IS NULL OR char_length(utm_source) <= 100),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 100),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 100),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK ((marketing_consent AND marketing_consent_recorded_at IS NOT NULL) OR
    (NOT marketing_consent AND marketing_consent_recorded_at IS NULL))
);

CREATE TABLE public.marketing_lead_rate_limits (
  scope text NOT NULL CHECK (scope IN ('ip', 'email')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (scope, fingerprint)
);

ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_leads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_lead_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_lead_rate_limits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.marketing_leads FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.marketing_lead_rate_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.submit_marketing_lead(
  p_lead_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_ip_fingerprint text,
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
  v_ip_started_at timestamptz;
  v_ip_count integer;
  v_email_started_at timestamptz;
  v_email_count integer;
  v_lock_key text;
BEGIN
  IF p_lead_id IS NULL OR p_idempotency_key IS NULL
    OR p_request_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_ip_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_email_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120
    OR p_business_email IS NULL OR pg_catalog.char_length(p_business_email) NOT BETWEEN 3 AND 254
    OR p_business_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    OR p_company IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_company)) NOT BETWEEN 1 AND 160
    OR p_role IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_role)) NOT BETWEEN 1 AND 160
    OR p_workflow_problem IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_workflow_problem)) NOT BETWEEN 8 AND 2400
    OR p_interest_type NOT IN ('early_access', 'demo')
    OR (p_current_process_tools IS NOT NULL AND pg_catalog.char_length(p_current_process_tools) > 1200)
    OR p_source NOT IN ('homepage', 'workflow_automation', 'workflow_preview', 'pricing', 'about', 'faq', 'direct', 'other')
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

  FOR v_lock_key IN
    SELECT lock_values.lock_key
    FROM (VALUES
      ('ip:' || p_ip_fingerprint),
      ('email:' || p_email_fingerprint)
    ) AS lock_values(lock_key)
    ORDER BY lock_values.lock_key
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_key, 0));
  END LOOP;

  SELECT rate.window_started_at, rate.request_count
    INTO v_ip_started_at, v_ip_count
  FROM public.marketing_lead_rate_limits AS rate
  WHERE rate.scope = 'ip' AND rate.fingerprint = p_ip_fingerprint
  FOR UPDATE;
  SELECT rate.window_started_at, rate.request_count
    INTO v_email_started_at, v_email_count
  FROM public.marketing_lead_rate_limits AS rate
  WHERE rate.scope = 'email' AND rate.fingerprint = p_email_fingerprint
  FOR UPDATE;

  IF v_ip_count >= 8 AND v_ip_started_at > v_now - interval '10 minutes' THEN RETURN 'rate_limited'; END IF;
  IF v_email_count >= 3 AND v_email_started_at > v_now - interval '24 hours' THEN RETURN 'rate_limited'; END IF;

  INSERT INTO public.marketing_lead_rate_limits (scope, fingerprint, window_started_at, request_count)
  VALUES ('ip', p_ip_fingerprint, v_now, 1)
  ON CONFLICT (scope, fingerprint) DO UPDATE SET
    window_started_at = CASE WHEN public.marketing_lead_rate_limits.window_started_at <= v_now - interval '10 minutes' THEN v_now ELSE public.marketing_lead_rate_limits.window_started_at END,
    request_count = CASE WHEN public.marketing_lead_rate_limits.window_started_at <= v_now - interval '10 minutes' THEN 1 ELSE public.marketing_lead_rate_limits.request_count + 1 END;
  INSERT INTO public.marketing_lead_rate_limits (scope, fingerprint, window_started_at, request_count)
  VALUES ('email', p_email_fingerprint, v_now, 1)
  ON CONFLICT (scope, fingerprint) DO UPDATE SET
    window_started_at = CASE WHEN public.marketing_lead_rate_limits.window_started_at <= v_now - interval '24 hours' THEN v_now ELSE public.marketing_lead_rate_limits.window_started_at END,
    request_count = CASE WHEN public.marketing_lead_rate_limits.window_started_at <= v_now - interval '24 hours' THEN 1 ELSE public.marketing_lead_rate_limits.request_count + 1 END;

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

  -- Bound cleanup work while retaining only recent rate-limit fingerprints.
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

REVOKE ALL ON FUNCTION public.submit_marketing_lead(uuid, uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_marketing_lead(uuid, uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text)
  TO service_role;

COMMENT ON TABLE public.marketing_leads IS
  'Private public-site lead submissions. Read access is reserved to authorized database operators; public traffic may submit only through submit_marketing_lead.';
COMMENT ON TABLE public.marketing_lead_rate_limits IS
  'Private HMAC-keyed rate-limit windows for public marketing lead submissions.';
COMMENT ON FUNCTION public.submit_marketing_lead(uuid, uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text) IS
  'Server-only validated marketing lead submission with request idempotency and shared IP/email rate limits.';

COMMIT;
