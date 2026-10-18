BEGIN;

-- External-provider transfer authorization is distinct from dataset
-- analytical-use approval and from source ingestion/read permissions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.capa_roles
    WHERE role_id = 'CAPA_ORG_ADMIN' AND status = 'active' AND human_authority
  ) THEN
    RAISE EXCEPTION 'QUALITY_DATA_ADMIN_ROLE_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.capa_roles
    WHERE role_id <> 'CAPA_ORG_ADMIN'
      AND 'quality_data.external_ai.manage' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'QUALITY_DATA_EXTERNAL_AI_PERMISSION_ROLE_CONFLICT';
  END IF;
END
$$;

UPDATE public.capa_roles
SET permissions = CASE
      WHEN 'quality_data.external_ai.manage' = ANY(permissions)
        THEN permissions
      ELSE array_append(permissions, 'quality_data.external_ai.manage')
    END,
    role_version = '1.4.0'
WHERE role_id = 'CAPA_ORG_ADMIN';

CREATE TABLE public.quality_data_external_ai_opt_in_events (
  event_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.capa_organizations (organization_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  transition_number integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('enabled', 'disabled')),
  actor_user_id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  rationale text NOT NULL,
  previous_event_id uuid,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  UNIQUE (organization_id, transition_number),
  UNIQUE (organization_id, event_id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, actor_user_id, actor_membership_id)
    REFERENCES public.capa_organization_memberships (organization_id, user_id, membership_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, previous_event_id)
    REFERENCES public.quality_data_external_ai_opt_in_events (organization_id, event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT quality_data_external_ai_opt_in_transition CHECK (transition_number > 0),
  CONSTRAINT quality_data_external_ai_opt_in_rationale CHECK (char_length(btrim(rationale)) BETWEEN 1 AND 1000),
  CONSTRAINT quality_data_external_ai_opt_in_idempotency CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT quality_data_external_ai_opt_in_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quality_data_external_ai_opt_in_previous CHECK ((transition_number = 1 AND previous_event_id IS NULL) OR (transition_number > 1 AND previous_event_id IS NOT NULL))
);

CREATE INDEX quality_data_external_ai_opt_in_latest_idx
  ON public.quality_data_external_ai_opt_in_events (organization_id, transition_number DESC);
CREATE TRIGGER quality_data_external_ai_opt_in_immutable
  BEFORE UPDATE OR DELETE ON public.quality_data_external_ai_opt_in_events
  FOR EACH ROW EXECUTE FUNCTION private.quality_data_reject_immutable_mutation();
ALTER TABLE public.quality_data_external_ai_opt_in_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_data_external_ai_opt_in_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.quality_data_external_ai_opt_in_events FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.quality_data_external_ai_opt_in_events IS
  'Append-only per-organization authorization for minimized external AI evidence transfer; disabled until an active CAPA_ORG_ADMIN records enabled.';

-- Shared request limits also cover Stage 3A analysis/approval and Stage 3C
-- model invocation/transfer-control changes. Limits are enforced by the
-- existing service-role-only RPC and fail closed at its caller.
ALTER TABLE public.quality_data_xlsx_api_rate_windows
  DROP CONSTRAINT quality_data_xlsx_api_rate_windows_action_check;
ALTER TABLE public.quality_data_xlsx_api_rate_windows
  ADD CONSTRAINT quality_data_xlsx_api_rate_windows_action_check
  CHECK (action IN ('inspect', 'preview', 'ingest', 'analysis', 'approval', 'ai_interpretation', 'external_ai_opt_in'));

CREATE OR REPLACE FUNCTION public.consume_quality_data_xlsx_api_rate_limit(
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
  IF p_user_id IS NULL OR p_action IS NULL OR p_action NOT IN (
    'inspect', 'preview', 'ingest', 'analysis', 'approval', 'ai_interpretation', 'external_ai_opt_in'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_QUALITY_DATA_RATE_LIMIT_REQUEST';
  END IF;

  v_limit := CASE p_action
    WHEN 'ingest' THEN 5
    WHEN 'ai_interpretation' THEN 3
    WHEN 'external_ai_opt_in' THEN 10
    ELSE 12
  END;
  v_now := pg_catalog.clock_timestamp();
  v_window_started_at := v_now;
  INSERT INTO public.quality_data_xlsx_api_rate_windows AS rate_window (
    user_id, action, window_started_at, request_count
  ) VALUES (p_user_id, p_action, v_window_started_at, 1)
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
REVOKE ALL ON FUNCTION public.consume_quality_data_xlsx_api_rate_limit(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_quality_data_xlsx_api_rate_limit(uuid, text) TO service_role;
COMMENT ON FUNCTION public.consume_quality_data_xlsx_api_rate_limit(uuid, text) IS
  'Atomically enforces shared per-user quality-data request limits, including a maximum of three Stage 3C external-AI interpretations per ten minutes.';

-- This table contains operational metadata only: opaque request IDs, model,
-- latency, outcome, token usage, and estimated cost. No org/user, prompt,
-- packet, source reference, result narrative, or customer content is stored.
CREATE TABLE public.quality_data_ai_interpretation_telemetry (
  telemetry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  model text NOT NULL CHECK (model = 'gpt-6-luna'),
  outcome text NOT NULL CHECK (outcome IN ('success', 'provider_error', 'invalid_output', 'cost_unavailable')),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens integer CHECK (total_tokens IS NULL OR total_tokens >= 0),
  estimated_cost_nano_usd bigint CHECK (estimated_cost_nano_usd IS NULL OR estimated_cost_nano_usd >= 0),
  pricing_version text CHECK (pricing_version IS NULL OR char_length(pricing_version) BETWEEN 1 AND 128)
);
CREATE INDEX quality_data_ai_interpretation_telemetry_occurred_at_idx
  ON public.quality_data_ai_interpretation_telemetry (occurred_at DESC);
ALTER TABLE public.quality_data_ai_interpretation_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_data_ai_interpretation_telemetry FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.quality_data_ai_interpretation_telemetry FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.quality_data_ai_interpretation_telemetry TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.quality_data_ai_interpretation_telemetry_telemetry_id_seq TO service_role;
COMMENT ON TABLE public.quality_data_ai_interpretation_telemetry IS
  'Privacy-minimized operational and provider-cost telemetry for Stage 3C; never stores evidence packets, narratives, source references, or tenant identities.';

COMMIT;
