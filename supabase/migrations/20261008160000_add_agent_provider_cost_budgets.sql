BEGIN;

CREATE TABLE public.agent_provider_cost_policies (
  version smallint PRIMARY KEY CHECK (version > 0),
  max_run_nano_usd bigint NOT NULL CHECK (max_run_nano_usd > 0),
  max_user_day_nano_usd bigint NOT NULL CHECK (max_user_day_nano_usd > 0),
  max_global_day_nano_usd bigint NOT NULL CHECK (max_global_day_nano_usd > 0),
  max_input_tokens integer NOT NULL CHECK (max_input_tokens BETWEEN 1 AND 16000),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 4096),
  max_openai_invocations integer NOT NULL CHECK (max_openai_invocations BETWEEN 1 AND 2),
  max_images integer NOT NULL CHECK (max_images BETWEEN 0 AND 1),
  allowed_capabilities text[] NOT NULL CHECK (
    allowed_capabilities = ARRAY['standard', 'file_analysis', 'document_generation', 'image_generation']::text[]
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_provider_cost_policy_amounts_check CHECK (
    max_run_nano_usd <= max_user_day_nano_usd
    AND max_user_day_nano_usd <= max_global_day_nano_usd
  )
);

CREATE TABLE public.agent_provider_cost_active_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  policy_version smallint NOT NULL REFERENCES public.agent_provider_cost_policies(version),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_provider_cost_prices (
  provider text NOT NULL CHECK (provider IN ('openai', 'replicate')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 128),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  input_nano_usd_per_token bigint,
  cached_input_nano_usd_per_token bigint,
  cache_write_nano_usd_per_token bigint,
  output_nano_usd_per_token bigint,
  image_nano_usd_per_output bigint,
  PRIMARY KEY (provider, model, version),
  CONSTRAINT agent_provider_cost_price_period_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT agent_provider_cost_price_dimensions_check CHECK (
    (provider = 'openai'
      AND input_nano_usd_per_token IS NOT NULL AND input_nano_usd_per_token >= 0
      AND cached_input_nano_usd_per_token IS NOT NULL AND cached_input_nano_usd_per_token >= 0
      AND cache_write_nano_usd_per_token IS NOT NULL AND cache_write_nano_usd_per_token >= 0
      AND output_nano_usd_per_token IS NOT NULL AND output_nano_usd_per_token >= 0
      AND image_nano_usd_per_output IS NULL)
    OR (provider = 'replicate'
      AND input_nano_usd_per_token IS NULL
      AND cached_input_nano_usd_per_token IS NULL
      AND cache_write_nano_usd_per_token IS NULL
      AND output_nano_usd_per_token IS NULL
      AND image_nano_usd_per_output > 0)
  )
);

CREATE TABLE public.agent_provider_cost_budget_locks (
  scope text NOT NULL CHECK (scope IN ('global', 'user')),
  scope_id text NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 64),
  PRIMARY KEY (scope, scope_id),
  CONSTRAINT agent_provider_cost_budget_lock_identity_check CHECK (
    (scope = 'global' AND scope_id = 'pilot')
    OR (scope = 'user' AND scope_id ~ '^[0-9a-f-]{36}$')
  )
);

CREATE TABLE public.agent_provider_cost_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  accepted_request_id uuid NOT NULL,
  step_id text NOT NULL,
  attempt_id uuid NOT NULL,
  attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  invocation_sequence smallint NOT NULL CHECK (invocation_sequence BETWEEN 1 AND 2),
  capability_id text NOT NULL CHECK (capability_id IN ('standard', 'file_analysis', 'document_generation', 'image_generation')),
  provider text NOT NULL CHECK (provider IN ('openai', 'replicate')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  policy_version smallint NOT NULL REFERENCES public.agent_provider_cost_policies(version),
  price_version text NOT NULL,
  accounting_day date NOT NULL,
  input_tokens integer,
  max_output_tokens integer,
  requested_images smallint,
  reservation_nano_usd bigint NOT NULL CHECK (reservation_nano_usd > 0),
  settled_nano_usd bigint CHECK (settled_nano_usd >= 0),
  status text NOT NULL CHECK (status IN ('admitted', 'dispatched', 'uncertain', 'settled', 'settled_estimated', 'released')),
  dispatch_started_at timestamptz,
  settled_at timestamptz,
  settlement_fingerprint text CHECK (settlement_fingerprint IS NULL OR settlement_fingerprint ~ '^[0-9a-f]{64}$'),
  settlement_kind text CHECK (settlement_kind IS NULL OR settlement_kind IN ('measured', 'schedule_derived')),
  observed_input_tokens integer CHECK (observed_input_tokens IS NULL OR observed_input_tokens >= 0),
  observed_cached_input_tokens integer CHECK (observed_cached_input_tokens IS NULL OR observed_cached_input_tokens >= 0),
  observed_cache_write_tokens integer CHECK (observed_cache_write_tokens IS NULL OR observed_cache_write_tokens >= 0),
  observed_output_tokens integer CHECK (observed_output_tokens IS NULL OR observed_output_tokens >= 0),
  observed_image_count smallint CHECK (observed_image_count IS NULL OR observed_image_count >= 0),
  provider_operation_id text CHECK (provider_operation_id IS NULL OR length(provider_operation_id) BETWEEN 1 AND 256),
  outcome_code text CHECK (outcome_code IS NULL OR outcome_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_provider_cost_admission_identity UNIQUE (run_id, step_id, attempt_id, invocation_sequence),
  CONSTRAINT agent_provider_cost_admission_execution_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT agent_provider_cost_admission_acceptance_fkey
    FOREIGN KEY (user_id, accepted_request_id)
    REFERENCES public.agent_request_acceptances(user_id, request_id) ON DELETE CASCADE,
  CONSTRAINT agent_provider_cost_admission_price_fkey
    FOREIGN KEY (provider, model, price_version)
    REFERENCES public.agent_provider_cost_prices(provider, model, version),
  CONSTRAINT agent_provider_cost_admission_step_fkey
    FOREIGN KEY (run_id, step_id) REFERENCES public.execution_steps(run_id, step_id) ON DELETE CASCADE,
  CONSTRAINT agent_provider_cost_admission_shape_check CHECK (
    (capability_id IN ('standard', 'file_analysis', 'document_generation') AND provider = 'openai'
      AND input_tokens IS NOT NULL AND max_output_tokens IS NOT NULL AND requested_images IS NULL
      AND input_tokens BETWEEN 0 AND 16000
      AND max_output_tokens BETWEEN 1 AND 4096
      AND requested_images IS NULL)
    OR (capability_id = 'image_generation' AND provider = 'replicate'
      AND input_tokens IS NULL AND max_output_tokens IS NULL AND requested_images IS NOT NULL
      AND input_tokens IS NULL AND max_output_tokens IS NULL AND requested_images = 1)
  ),
  CONSTRAINT agent_provider_cost_admission_settlement_check CHECK (
    (status IN ('admitted', 'dispatched', 'uncertain') AND settled_nano_usd IS NULL AND settled_at IS NULL)
    OR (status IN ('settled', 'settled_estimated') AND settled_nano_usd IS NOT NULL AND settled_at IS NOT NULL
      AND settlement_fingerprint IS NOT NULL AND settlement_kind IS NOT NULL)
    OR (status = 'released' AND settled_nano_usd = 0 AND settled_at IS NOT NULL
      AND settlement_fingerprint IS NOT NULL AND settlement_kind = 'measured')
  )
);

CREATE INDEX agent_provider_cost_admissions_run_status_idx
  ON public.agent_provider_cost_admissions (run_id, status);
CREATE INDEX agent_provider_cost_admissions_user_day_idx
  ON public.agent_provider_cost_admissions (user_id, accounting_day, status);
CREATE UNIQUE INDEX agent_provider_cost_admissions_provider_operation_idx
  ON public.agent_provider_cost_admissions (provider, provider_operation_id)
  WHERE provider_operation_id IS NOT NULL;

ALTER TABLE public.agent_provider_cost_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_active_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_active_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_budget_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_budget_locks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_provider_cost_admissions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_provider_cost_policies, public.agent_provider_cost_active_policy,
  public.agent_provider_cost_prices, public.agent_provider_cost_budget_locks,
  public.agent_provider_cost_admissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.agent_provider_cost_policies, public.agent_provider_cost_active_policy,
  public.agent_provider_cost_prices, public.agent_provider_cost_admissions TO service_role;

INSERT INTO public.agent_provider_cost_policies (
  version, max_run_nano_usd, max_user_day_nano_usd, max_global_day_nano_usd,
  max_input_tokens, max_output_tokens, max_openai_invocations, max_images, allowed_capabilities
) VALUES (
  1, 250000000, 500000000, 3000000000,
  16000, 4096, 2, 1,
  ARRAY['standard', 'file_analysis', 'document_generation', 'image_generation']::text[]
);

INSERT INTO public.agent_provider_cost_active_policy (singleton, policy_version)
VALUES (true, 1);

INSERT INTO public.agent_provider_cost_prices (
  provider, model, version, effective_from,
  input_nano_usd_per_token, cached_input_nano_usd_per_token,
  cache_write_nano_usd_per_token, output_nano_usd_per_token
) VALUES (
  'openai', 'gpt-6-luna', 'openai-gpt-6-luna-2026-10-03', '2026-10-03T00:00:00Z',
  100, 10, 125, 500
);

INSERT INTO public.agent_provider_cost_prices (
  provider, model, version, effective_from, image_nano_usd_per_output
) VALUES (
  'replicate', 'flux-schnell', 'replicate-flux-schnell-2026-10-08', '2026-10-08T00:00:00Z',
  3000000
);

CREATE FUNCTION public.reject_agent_provider_cost_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Agent provider cost policy and price history is immutable';
END;
$function$;

CREATE TRIGGER agent_provider_cost_policies_immutable
  BEFORE UPDATE OR DELETE ON public.agent_provider_cost_policies
  FOR EACH ROW EXECUTE FUNCTION public.reject_agent_provider_cost_policy_mutation();
CREATE TRIGGER agent_provider_cost_prices_immutable
  BEFORE UPDATE OR DELETE ON public.agent_provider_cost_prices
  FOR EACH ROW EXECUTE FUNCTION public.reject_agent_provider_cost_policy_mutation();

CREATE FUNCTION public.admit_agent_provider_cost(
  p_run_id uuid,
  p_step_id text,
  p_attempt_id uuid,
  p_attempt_number smallint,
  p_invocation_sequence smallint,
  p_capability_id text,
  p_provider text,
  p_model text,
  p_input_tokens integer,
  p_max_output_tokens integer,
  p_requested_images smallint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run public.execution_runs%ROWTYPE;
  v_step public.execution_steps%ROWTYPE;
  v_policy public.agent_provider_cost_policies%ROWTYPE;
  v_price public.agent_provider_cost_prices%ROWTYPE;
  v_existing public.agent_provider_cost_admissions%ROWTYPE;
  v_day date := (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date;
  v_reserved bigint;
  v_run_exposure bigint;
  v_user_exposure bigint;
  v_global_exposure bigint;
  v_count bigint;
  v_id uuid;
  v_scope_id text;
BEGIN
  SELECT run.* INTO v_run FROM public.execution_runs AS run WHERE run.id = p_run_id;
  IF NOT FOUND OR v_run.accepted_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_RUN_INELIGIBLE';
  END IF;
  INSERT INTO public.agent_provider_cost_budget_locks(scope, scope_id)
  VALUES ('global', 'pilot') ON CONFLICT DO NOTHING;
  v_scope_id := v_run.user_id::text;
  INSERT INTO public.agent_provider_cost_budget_locks(scope, scope_id)
  VALUES ('user', v_scope_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.agent_provider_cost_budget_locks WHERE scope = 'global' AND scope_id = 'pilot' FOR UPDATE;
  PERFORM 1 FROM public.agent_provider_cost_budget_locks WHERE scope = 'user' AND scope_id = v_scope_id FOR UPDATE;
  SELECT run.* INTO v_run FROM public.execution_runs AS run
    WHERE run.id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.accepted_request_id IS NULL
     OR v_run.status <> 'running' OR v_run.control_state <> 'active'
     OR NOT EXISTS (
       SELECT 1 FROM public.agent_request_acceptances AS acceptance
       WHERE acceptance.request_id = v_run.accepted_request_id
         AND acceptance.user_id = v_run.user_id
         AND acceptance.conversation_id::text = v_run.runtime_context->>'conversationId'
         AND acceptance.request_id::text = v_run.runtime_context#>>'{requestMessageBinding,requestId}'
         AND acceptance.user_message_id::text = v_run.runtime_context#>>'{requestMessageBinding,userMessageId}'
         AND acceptance.assistant_message_id::text = v_run.runtime_context#>>'{requestMessageBinding,assistantMessageId}'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_RUN_INELIGIBLE';
  END IF;

  SELECT step.* INTO v_step FROM public.execution_steps AS step
    WHERE step.run_id = p_run_id AND step.step_id = p_step_id FOR UPDATE;
  IF NOT FOUND OR v_step.user_id <> v_run.user_id OR v_step.status <> 'running'
     OR v_step.execution_key <> p_attempt_id OR v_step.attempt <> p_attempt_number
     OR v_step.capability_id <> p_capability_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_STEP_INELIGIBLE';
  END IF;
  IF v_run.control_state <> 'active' OR EXISTS (
    SELECT 1 FROM public.execution_human_approval_checkpoints AS approval
    WHERE approval.run_id = p_run_id AND approval.step_id = p_step_id AND approval.status = 'pending'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_CONTROL_BLOCKED';
  END IF;

  SELECT policy.* INTO v_policy
  FROM public.agent_provider_cost_active_policy AS active
  JOIN public.agent_provider_cost_policies AS policy ON policy.version = active.policy_version
  WHERE active.singleton;
  IF NOT FOUND OR NOT (p_capability_id = ANY(v_policy.allowed_capabilities))
     OR p_capability_id IN ('web_search', 'image_editing')
     OR NOT ((p_capability_id IN ('standard', 'file_analysis', 'document_generation')
          AND p_provider = 'openai' AND p_model = 'gpt-6-luna'
          AND p_input_tokens IS NOT NULL AND p_input_tokens BETWEEN 0 AND v_policy.max_input_tokens
          AND p_max_output_tokens IS NOT NULL
          AND p_max_output_tokens BETWEEN 1 AND v_policy.max_output_tokens AND p_requested_images IS NULL)
       OR (p_capability_id = 'image_generation' AND p_provider = 'replicate'
          AND p_model = 'flux-schnell' AND p_input_tokens IS NULL
          AND p_max_output_tokens IS NULL AND p_requested_images IS NOT NULL AND p_requested_images = 1)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_POLICY_DENIED';
  END IF;

  SELECT price.* INTO v_price FROM public.agent_provider_cost_prices AS price
    WHERE price.provider = p_provider AND price.model = p_model
      AND price.effective_from <= pg_catalog.clock_timestamp()
      AND (price.effective_to IS NULL OR price.effective_to > pg_catalog.clock_timestamp());
  IF NOT FOUND OR (SELECT pg_catalog.count(*) FROM public.agent_provider_cost_prices AS price
      WHERE price.provider = p_provider AND price.model = p_model
        AND price.effective_from <= pg_catalog.clock_timestamp()
        AND (price.effective_to IS NULL OR price.effective_to > pg_catalog.clock_timestamp())) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_PRICE_UNAVAILABLE';
  END IF;

  IF p_capability_id IN ('standard', 'file_analysis', 'document_generation') THEN
    v_reserved := (p_input_tokens::bigint * greatest(
      v_price.input_nano_usd_per_token,
      v_price.cached_input_nano_usd_per_token,
      v_price.cache_write_nano_usd_per_token
    )) + (p_max_output_tokens::bigint * v_price.output_nano_usd_per_token);
  ELSE
    v_reserved := p_requested_images::bigint * v_price.image_nano_usd_per_output;
  END IF;
  IF v_reserved <= 0 OR v_reserved > v_policy.max_run_nano_usd THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_POLICY_DENIED';
  END IF;

  SELECT admission.* INTO v_existing FROM public.agent_provider_cost_admissions AS admission
  WHERE admission.run_id = p_run_id AND admission.step_id = p_step_id
    AND admission.attempt_id = p_attempt_id AND admission.invocation_sequence = p_invocation_sequence
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.attempt_number <> p_attempt_number OR v_existing.capability_id <> p_capability_id
       OR v_existing.provider <> p_provider OR v_existing.model <> p_model
       OR v_existing.input_tokens IS DISTINCT FROM p_input_tokens
       OR v_existing.max_output_tokens IS DISTINCT FROM p_max_output_tokens
       OR v_existing.requested_images IS DISTINCT FROM p_requested_images
       OR v_existing.policy_version <> v_policy.version OR v_existing.price_version <> v_price.version THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_IDENTITY_CONFLICT';
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', v_existing.status, 'admission_id', v_existing.id, 'may_dispatch', false);
  END IF;
  IF p_invocation_sequence < 1 OR p_invocation_sequence > 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_INVOCATION_LIMIT';
  END IF;

  SELECT pg_catalog.count(*) INTO v_count FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.run_id = p_run_id
      AND admission.capability_id IN ('standard', 'file_analysis', 'document_generation')
      AND admission.status <> 'released';
  IF p_capability_id IN ('standard', 'file_analysis', 'document_generation')
     AND v_count >= v_policy.max_openai_invocations THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_INVOCATION_LIMIT';
  END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.run_id = p_run_id AND admission.capability_id = 'image_generation' AND admission.status <> 'released';
  IF p_capability_id = 'image_generation' AND v_count >= v_policy.max_images THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_IMAGE_LIMIT';
  END IF;

  SELECT COALESCE(pg_catalog.sum(CASE WHEN admission.status IN ('admitted', 'dispatched', 'uncertain')
      THEN admission.reservation_nano_usd ELSE admission.settled_nano_usd END), 0)
    INTO v_run_exposure FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.run_id = p_run_id AND admission.status <> 'released';
  IF v_run_exposure + v_reserved > v_policy.max_run_nano_usd THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_RUN_BUDGET_EXHAUSTED';
  END IF;

  SELECT COALESCE(pg_catalog.sum(CASE
      WHEN admission.status IN ('admitted', 'dispatched', 'uncertain') THEN admission.reservation_nano_usd
      WHEN admission.accounting_day = v_day THEN admission.settled_nano_usd ELSE 0 END), 0)
    INTO v_user_exposure FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.user_id = v_run.user_id AND admission.status <> 'released';
  IF v_user_exposure + v_reserved > v_policy.max_user_day_nano_usd THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_USER_DAY_BUDGET_EXHAUSTED';
  END IF;

  SELECT COALESCE(pg_catalog.sum(CASE
      WHEN admission.status IN ('admitted', 'dispatched', 'uncertain') THEN admission.reservation_nano_usd
      WHEN admission.accounting_day = v_day THEN admission.settled_nano_usd ELSE 0 END), 0)
    INTO v_global_exposure FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.status <> 'released';
  IF v_global_exposure + v_reserved > v_policy.max_global_day_nano_usd THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_GLOBAL_DAY_BUDGET_EXHAUSTED';
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO public.agent_provider_cost_admissions (
    id, run_id, user_id, accepted_request_id, step_id, attempt_id, attempt_number, invocation_sequence,
    capability_id, provider, model, policy_version, price_version, accounting_day,
    input_tokens, max_output_tokens, requested_images, reservation_nano_usd, status
  ) VALUES (
    v_id, p_run_id, v_run.user_id, v_run.accepted_request_id, p_step_id, p_attempt_id, p_attempt_number, p_invocation_sequence,
    p_capability_id, p_provider, p_model, v_policy.version, v_price.version, v_day,
    p_input_tokens, p_max_output_tokens, p_requested_images, v_reserved, 'admitted'
  );
  RETURN pg_catalog.jsonb_build_object('status', 'admitted', 'admission_id', v_id, 'may_dispatch', true,
    'reserved_nano_usd', v_reserved, 'policy_version', v_policy.version, 'price_version', v_price.version);
END;
$function$;

CREATE FUNCTION public.begin_agent_provider_cost_dispatch(p_admission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_admission public.agent_provider_cost_admissions%ROWTYPE;
  v_run public.execution_runs%ROWTYPE;
  v_step public.execution_steps%ROWTYPE;
BEGIN
  SELECT admission.* INTO v_admission FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.id = p_admission_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_ADMISSION_NOT_FOUND'; END IF;
  SELECT run.* INTO v_run FROM public.execution_runs AS run WHERE run.id = v_admission.run_id FOR UPDATE;
  SELECT step.* INTO v_step FROM public.execution_steps AS step
    WHERE step.run_id = v_admission.run_id AND step.step_id = v_admission.step_id FOR UPDATE;
  SELECT admission.* INTO v_admission FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.id = p_admission_id FOR UPDATE;
  IF v_admission.status <> 'admitted' THEN
    RETURN pg_catalog.jsonb_build_object('status', v_admission.status, 'may_dispatch', false);
  END IF;
  IF v_run.id IS NULL OR v_step.run_id IS NULL
     OR v_run.user_id <> v_admission.user_id OR v_run.accepted_request_id IS NULL
     OR v_run.status <> 'running' OR v_run.control_state <> 'active'
     OR v_step.user_id <> v_admission.user_id OR v_step.status <> 'running'
     OR v_step.execution_key <> v_admission.attempt_id OR v_step.attempt <> v_admission.attempt_number
     OR v_step.capability_id <> v_admission.capability_id
     OR NOT EXISTS (
       SELECT 1 FROM public.agent_request_acceptances AS acceptance
       WHERE acceptance.request_id = v_run.accepted_request_id
         AND acceptance.user_id = v_run.user_id
         AND acceptance.conversation_id::text = v_run.runtime_context->>'conversationId'
         AND acceptance.request_id::text = v_run.runtime_context#>>'{requestMessageBinding,requestId}'
         AND acceptance.user_message_id::text = v_run.runtime_context#>>'{requestMessageBinding,userMessageId}'
         AND acceptance.assistant_message_id::text = v_run.runtime_context#>>'{requestMessageBinding,assistantMessageId}'
     )
     OR EXISTS (SELECT 1 FROM public.execution_human_approval_checkpoints AS approval
       WHERE approval.run_id = v_admission.run_id AND approval.step_id = v_admission.step_id AND approval.status = 'pending') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_CONTROL_BLOCKED';
  END IF;
  UPDATE public.agent_provider_cost_admissions AS admission
    SET status = 'dispatched', dispatch_started_at = pg_catalog.clock_timestamp()
    WHERE admission.id = v_admission.id;
  RETURN pg_catalog.jsonb_build_object('status', 'dispatched', 'may_dispatch', true);
END;
$function$;

CREATE FUNCTION public.settle_agent_provider_cost(
  p_admission_id uuid,
  p_outcome text,
  p_settlement_fingerprint text,
  p_input_tokens integer DEFAULT NULL,
  p_cached_input_tokens integer DEFAULT NULL,
  p_cache_write_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_image_count smallint DEFAULT NULL,
  p_provider_operation_id text DEFAULT NULL,
  p_outcome_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_admission public.agent_provider_cost_admissions%ROWTYPE;
  v_price public.agent_provider_cost_prices%ROWTYPE;
  v_cost bigint;
  v_kind text;
  v_cached integer;
  v_cache_write integer;
  v_remaining integer;
  v_scope_id text;
  v_settlement_status text := 'settled_estimated';
BEGIN
  SELECT admission.* INTO v_admission FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.id = p_admission_id;
  IF NOT FOUND OR p_outcome IS NULL OR p_outcome NOT IN ('settled', 'uncertain', 'no_charge')
     OR p_settlement_fingerprint IS NULL OR p_settlement_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_SETTLEMENT_INVALID';
  END IF;
  INSERT INTO public.agent_provider_cost_budget_locks(scope, scope_id)
  VALUES ('global', 'pilot') ON CONFLICT DO NOTHING;
  v_scope_id := v_admission.user_id::text;
  INSERT INTO public.agent_provider_cost_budget_locks(scope, scope_id)
  VALUES ('user', v_scope_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.agent_provider_cost_budget_locks WHERE scope = 'global' AND scope_id = 'pilot' FOR UPDATE;
  PERFORM 1 FROM public.agent_provider_cost_budget_locks WHERE scope = 'user' AND scope_id = v_scope_id FOR UPDATE;
  SELECT admission.* INTO v_admission FROM public.agent_provider_cost_admissions AS admission
    WHERE admission.id = p_admission_id FOR UPDATE;
  IF v_admission.status IN ('settled', 'settled_estimated', 'released') THEN
    IF v_admission.settlement_fingerprint = p_settlement_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('status', v_admission.status, 'idempotent', true,
        'settled_nano_usd', v_admission.settled_nano_usd);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_SETTLEMENT_CONFLICT';
  END IF;
  IF p_provider_operation_id IS NOT NULL AND v_admission.provider_operation_id IS NOT NULL
     AND p_provider_operation_id <> v_admission.provider_operation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_OPERATION_ID_CONFLICT';
  END IF;
  IF p_outcome = 'no_charge' AND NOT (
    (v_admission.status = 'admitted' AND v_admission.dispatch_started_at IS NULL)
    OR (v_admission.status IN ('dispatched', 'uncertain') AND p_outcome_code = 'provider_dns_before_send')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_NO_CHARGE_AFTER_DISPATCH';
  END IF;
  IF p_outcome IN ('settled', 'uncertain') AND v_admission.dispatch_started_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_NOT_DISPATCHED';
  END IF;

  SELECT price.* INTO v_price FROM public.agent_provider_cost_prices AS price
    WHERE price.provider = v_admission.provider AND price.model = v_admission.model
      AND price.version = v_admission.price_version;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENT_PROVIDER_COST_PRICE_UNAVAILABLE'; END IF;

  IF p_outcome = 'uncertain' THEN
    UPDATE public.agent_provider_cost_admissions AS admission SET status = 'uncertain',
      outcome_code = COALESCE(p_outcome_code, 'provider_outcome_unknown'),
      provider_operation_id = COALESCE(p_provider_operation_id, admission.provider_operation_id)
      WHERE admission.id = v_admission.id;
    RETURN pg_catalog.jsonb_build_object('status', 'uncertain', 'reservation_retained', true);
  ELSIF p_outcome = 'no_charge' THEN
    UPDATE public.agent_provider_cost_admissions AS admission SET status = 'released', settled_nano_usd = 0,
      settled_at = pg_catalog.clock_timestamp(), settlement_fingerprint = p_settlement_fingerprint,
      settlement_kind = 'measured', outcome_code = COALESCE(p_outcome_code, 'pre_dispatch_no_charge')
      WHERE admission.id = v_admission.id;
    RETURN pg_catalog.jsonb_build_object('status', 'released', 'settled_nano_usd', 0);
  END IF;

  IF v_admission.capability_id = 'image_generation' THEN
    IF p_image_count IS NULL OR p_image_count < 0 THEN
      v_cost := v_admission.reservation_nano_usd;
      v_kind := 'schedule_derived';
    ELSE
      v_cost := p_image_count::bigint * v_price.image_nano_usd_per_output;
      v_kind := 'schedule_derived';
    END IF;
  ELSIF p_input_tokens IS NULL OR p_output_tokens IS NULL
     OR p_input_tokens < 0 OR p_output_tokens < 0
     OR p_input_tokens > 100000000 OR p_output_tokens > 100000000 THEN
    v_cost := v_admission.reservation_nano_usd;
    v_kind := 'schedule_derived';
  ELSE
    v_cached := COALESCE(p_cached_input_tokens, 0);
    v_cache_write := COALESCE(p_cache_write_tokens, 0);
    IF v_cached < 0 OR v_cache_write < 0 OR v_cached > p_input_tokens
       OR v_cache_write > p_input_tokens - v_cached THEN
      v_cost := v_admission.reservation_nano_usd;
      v_kind := 'schedule_derived';
      v_cached := 0;
      v_cache_write := 0;
    ELSE
      v_remaining := p_input_tokens - v_cached - v_cache_write;
      v_cost := v_cached::bigint * v_price.cached_input_nano_usd_per_token
        + v_cache_write::bigint * v_price.cache_write_nano_usd_per_token
        + v_remaining::bigint * v_price.input_nano_usd_per_token
        + p_output_tokens::bigint * v_price.output_nano_usd_per_token;
      v_kind := CASE WHEN p_cached_input_tokens IS NULL OR p_cache_write_tokens IS NULL
        THEN 'schedule_derived' ELSE 'measured' END;
      IF v_kind = 'measured' THEN v_settlement_status := 'settled'; END IF;
      IF v_kind = 'schedule_derived' THEN
        v_cost := greatest(v_cost, v_admission.reservation_nano_usd);
      END IF;
    END IF;
  END IF;

  UPDATE public.agent_provider_cost_admissions AS admission SET
    status = v_settlement_status,
    settled_nano_usd = v_cost,
    settled_at = pg_catalog.clock_timestamp(),
    settlement_fingerprint = p_settlement_fingerprint,
    settlement_kind = v_kind,
    observed_input_tokens = p_input_tokens,
    observed_cached_input_tokens = p_cached_input_tokens,
    observed_cache_write_tokens = p_cache_write_tokens,
    observed_output_tokens = p_output_tokens,
    observed_image_count = p_image_count,
    provider_operation_id = COALESCE(p_provider_operation_id, admission.provider_operation_id),
    outcome_code = CASE WHEN v_cost > admission.reservation_nano_usd THEN 'provider_cost_overrun'
      ELSE COALESCE(p_outcome_code, 'provider_succeeded') END
    WHERE admission.id = v_admission.id;
  RETURN pg_catalog.jsonb_build_object('status', v_settlement_status,
    'settled_nano_usd', v_cost, 'overrun', v_cost > v_admission.reservation_nano_usd,
    'settlement_kind', v_kind);
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_agent_provider_cost_policy_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admit_agent_provider_cost(uuid, text, uuid, smallint, smallint, text, text, text, integer, integer, smallint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_agent_provider_cost_dispatch(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_agent_provider_cost(uuid, text, text, integer, integer, integer, integer, smallint, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admit_agent_provider_cost(uuid, text, uuid, smallint, smallint, text, text, text, integer, integer, smallint) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_agent_provider_cost_dispatch(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_agent_provider_cost(uuid, text, text, integer, integer, integer, integer, smallint, text, text) TO service_role;

COMMENT ON TABLE public.agent_provider_cost_admissions IS
  'Append-only identity and durable reservation state for provider invocations in dormant Agent Runtime V1. Unknown dispatched outcomes keep the full admission reserve.';
COMMENT ON COLUMN public.agent_provider_cost_admissions.accounting_day IS
  'UTC admission date; unsettled reservations remain exposure across day rollover and settle against this original date.';
COMMENT ON TABLE public.agent_provider_cost_policies IS
  'Immutable server-approved financial policy versions; activate future versions by changing the singleton pointer through a reviewed migration.';

COMMIT;
