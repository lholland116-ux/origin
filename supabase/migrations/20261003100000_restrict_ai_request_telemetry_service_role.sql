BEGIN;

REVOKE ALL PRIVILEGES
ON TABLE public.ai_request_telemetry
FROM service_role;

GRANT SELECT, INSERT, DELETE
ON TABLE public.ai_request_telemetry
TO service_role;

REVOKE ALL PRIVILEGES
ON SEQUENCE public.ai_request_telemetry_id_seq
FROM service_role;

GRANT USAGE
ON SEQUENCE public.ai_request_telemetry_id_seq
TO service_role;

COMMIT;
