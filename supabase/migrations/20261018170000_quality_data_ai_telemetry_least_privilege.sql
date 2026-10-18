BEGIN;

-- The baseline database grants broad defaults for objects created by
-- postgres. Override those defaults on this privacy-sensitive table and its
-- identity sequence without changing the global defaults or RLS policies.
REVOKE ALL PRIVILEGES ON TABLE public.quality_data_ai_interpretation_telemetry
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.quality_data_ai_interpretation_telemetry
  TO service_role;

REVOKE ALL PRIVILEGES ON SEQUENCE public.quality_data_ai_interpretation_telemetry_telemetry_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.quality_data_ai_interpretation_telemetry_telemetry_id_seq
  TO service_role;

COMMIT;
