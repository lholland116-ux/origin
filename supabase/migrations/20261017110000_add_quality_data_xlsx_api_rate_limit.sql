BEGIN;

CREATE TABLE public.quality_data_xlsx_api_rate_windows (
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('inspect', 'preview', 'ingest')),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (user_id, action)
);

CREATE TABLE public.quality_data_xlsx_api_parse_leases (
  lease_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.quality_data_xlsx_api_rate_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_data_xlsx_api_rate_windows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quality_data_xlsx_api_rate_windows FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.quality_data_xlsx_api_parse_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_data_xlsx_api_parse_leases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quality_data_xlsx_api_parse_leases FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX quality_data_xlsx_api_parse_leases_expiry_idx
  ON public.quality_data_xlsx_api_parse_leases (expires_at);

CREATE FUNCTION public.consume_quality_data_xlsx_api_rate_limit(
  p_user_id uuid,
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer;
  v_now timestamptz;
  v_window_started_at timestamptz;
  v_request_count integer;
BEGIN
  IF p_user_id IS NULL OR p_action IS NULL OR p_action NOT IN ('inspect', 'preview', 'ingest') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_QUALITY_DATA_RATE_LIMIT_REQUEST';
  END IF;

  v_limit := CASE p_action WHEN 'ingest' THEN 5 ELSE 12 END;
  v_now := pg_catalog.clock_timestamp();
  v_window_started_at := v_now;

  INSERT INTO public.quality_data_xlsx_api_rate_windows AS rate_window (
    user_id, action, window_started_at, request_count
  ) VALUES (
    p_user_id, p_action, v_window_started_at, 1
  )
  ON CONFLICT (user_id, action) DO UPDATE
    SET window_started_at = CASE
          WHEN rate_window.window_started_at + interval '10 minutes' <= v_now THEN v_now
          ELSE rate_window.window_started_at
        END,
        request_count = CASE
          WHEN rate_window.window_started_at + interval '10 minutes' <= v_now THEN 1
          ELSE rate_window.request_count + 1
        END
    WHERE rate_window.window_started_at + interval '10 minutes' <= v_now
       OR rate_window.request_count < v_limit
  RETURNING request_count INTO v_request_count;

  RETURN v_request_count IS NOT NULL;
END;
$function$;

CREATE FUNCTION public.acquire_quality_data_xlsx_api_parse_slot(
  p_lease_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_active_count integer;
BEGIN
  IF p_lease_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_QUALITY_DATA_PARSE_LEASE';
  END IF;

  -- Serialize only the short slot-allocation transaction across app processes.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('quality-data-xlsx-api-parse-slot', 0)
  );
  DELETE FROM public.quality_data_xlsx_api_parse_leases
  WHERE expires_at <= pg_catalog.clock_timestamp();

  SELECT pg_catalog.count(*)::integer INTO v_active_count
  FROM public.quality_data_xlsx_api_parse_leases;
  IF v_active_count >= 2 THEN
    RETURN false;
  END IF;

  INSERT INTO public.quality_data_xlsx_api_parse_leases (lease_id, user_id, expires_at)
  VALUES (p_lease_id, p_user_id, pg_catalog.clock_timestamp() + interval '45 seconds')
  ON CONFLICT (lease_id) DO NOTHING;

  RETURN FOUND;
END;
$function$;

CREATE FUNCTION public.release_quality_data_xlsx_api_parse_slot(p_lease_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF p_lease_id IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM public.quality_data_xlsx_api_parse_leases
  WHERE lease_id = p_lease_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_quality_data_xlsx_api_rate_limit(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.acquire_quality_data_xlsx_api_parse_slot(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_quality_data_xlsx_api_parse_slot(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_quality_data_xlsx_api_rate_limit(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_quality_data_xlsx_api_parse_slot(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_quality_data_xlsx_api_parse_slot(uuid) TO service_role;

COMMENT ON TABLE public.quality_data_xlsx_api_rate_windows IS
  'Private fixed-window quality-data XLSX request counters; mutable only through a restricted server-side RPC.';
COMMENT ON FUNCTION public.consume_quality_data_xlsx_api_rate_limit(uuid, text) IS
  'Atomically enforces per-user request limits for quality-data XLSX inspection, preview, and ingestion.';
COMMENT ON FUNCTION public.acquire_quality_data_xlsx_api_parse_slot(uuid, uuid) IS
  'Atomically grants one of two global, short-lived quality-data XLSX parsing leases.';
COMMENT ON FUNCTION public.release_quality_data_xlsx_api_parse_slot(uuid) IS
  'Releases a quality-data XLSX parsing lease; abandoned leases expire automatically.';

COMMIT;
