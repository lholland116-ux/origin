BEGIN;

REVOKE ALL PRIVILEGES
ON SEQUENCE public.ai_request_telemetry_id_seq
FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE
ON SEQUENCE public.ai_request_telemetry_id_seq
TO service_role;

COMMIT;
