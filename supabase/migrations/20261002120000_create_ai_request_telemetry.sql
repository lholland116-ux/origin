BEGIN;

CREATE TABLE public.ai_request_telemetry (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  route                 text NOT NULL,
  attempt_kind          text NOT NULL,
  model                 text NOT NULL,
  reasoning_effort      text NOT NULL,
  plan                  text NOT NULL,
  outcome               text NOT NULL,
  latency_ms            integer NOT NULL,
  had_image             boolean NOT NULL DEFAULT false,
  input_tokens          integer,
  cached_input_tokens   integer,
  output_tokens         integer,
  reasoning_tokens      integer,
  total_tokens          integer,

  CONSTRAINT ai_request_telemetry_route_check
    CHECK (route IN ('standard', 'web_search')),
  CONSTRAINT ai_request_telemetry_attempt_kind_check
    CHECK (attempt_kind IN ('primary', 'image_retry')),
  CONSTRAINT ai_request_telemetry_model_check
    CHECK (char_length(btrim(model)) BETWEEN 1 AND 128),
  CONSTRAINT ai_request_telemetry_reasoning_effort_check
    CHECK (reasoning_effort IN ('none', 'low', 'medium', 'high', 'xhigh', 'max')),
  CONSTRAINT ai_request_telemetry_plan_check
    CHECK (plan IN ('free', 'pro')),
  CONSTRAINT ai_request_telemetry_outcome_check
    CHECK (outcome IN ('success', 'api_error', 'cancelled', 'incomplete')),
  CONSTRAINT ai_request_telemetry_latency_ms_check
    CHECK (latency_ms >= 0),
  CONSTRAINT ai_request_telemetry_input_tokens_check
    CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CONSTRAINT ai_request_telemetry_cached_input_tokens_check
    CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  CONSTRAINT ai_request_telemetry_output_tokens_check
    CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CONSTRAINT ai_request_telemetry_reasoning_tokens_check
    CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  CONSTRAINT ai_request_telemetry_total_tokens_check
    CHECK (total_tokens IS NULL OR total_tokens >= 0)
);

CREATE INDEX ai_request_telemetry_occurred_at_idx
  ON public.ai_request_telemetry (occurred_at DESC);

CREATE INDEX ai_request_telemetry_route_effort_occurred_at_idx
  ON public.ai_request_telemetry (route, reasoning_effort, occurred_at DESC);

ALTER TABLE public.ai_request_telemetry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_request_telemetry FROM PUBLIC;
REVOKE ALL ON public.ai_request_telemetry FROM anon;
REVOKE ALL ON public.ai_request_telemetry FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.ai_request_telemetry TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_request_telemetry_id_seq TO service_role;

COMMENT ON TABLE public.ai_request_telemetry IS
  'Privacy-minimized server-only OpenAI invocation telemetry. Retain records for 90 days; a retention job is deployed separately.';

COMMIT;
