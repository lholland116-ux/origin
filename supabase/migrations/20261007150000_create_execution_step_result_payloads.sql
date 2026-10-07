-- Bounded, immutable JSON results larger than the existing 64 KiB step envelope.
-- Payload creation and the execution_steps reference are written in the same
-- SupabaseExecutionStore checkpoint transaction.
-- serialized_size_bytes measures compact JSON.stringify UTF-8 bytes (maximum 1,310,720).
-- jsonb::text is separately capped at 2x to allow its separator whitespace while
-- still keeping the database representation bounded.

CREATE TABLE public.execution_step_result_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_id text NOT NULL,
  result_kind text NOT NULL CHECK (result_kind IN ('text', 'search_results', 'image', 'structured_data', 'artifact', 'document')),
  payload jsonb NOT NULL,
  serialized_size_bytes integer NOT NULL CHECK (serialized_size_bytes BETWEEN 1 AND 1310720),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_step_result_payloads_payload_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ->> 'kind' = result_kind
    AND octet_length(payload::text) BETWEEN 1 AND 2621440
  ),
  CONSTRAINT execution_step_result_payloads_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_step_result_payloads_run_step_fkey
    FOREIGN KEY (run_id, step_id) REFERENCES public.execution_steps(run_id, step_id) ON DELETE CASCADE,
  CONSTRAINT execution_step_result_payloads_one_per_step UNIQUE (run_id, user_id, step_id),
  CONSTRAINT execution_step_result_payloads_reference_key UNIQUE (id, run_id, user_id, step_id)
);

ALTER TABLE public.execution_steps
  ADD COLUMN result_payload_id uuid;

ALTER TABLE public.execution_steps
  ADD CONSTRAINT execution_steps_payload_reference_check CHECK (
    result_payload_id IS NULL OR (
      status = 'succeeded'
      AND jsonb_typeof(result_envelope) = 'object'
      AND result_envelope -> 'value' ->> 'storage' = 'payload_ref'
      AND result_envelope -> 'value' ->> 'payloadId' = result_payload_id::text
      AND result_envelope -> 'value' ->> 'resultKind' = result_envelope ->> 'kind'
    )
  ),
  ADD CONSTRAINT execution_steps_result_payload_fkey
    FOREIGN KEY (result_payload_id, run_id, user_id, step_id)
    REFERENCES public.execution_step_result_payloads(id, run_id, user_id, step_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.prevent_execution_step_result_payload_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Execution result payloads are immutable';
END;
$function$;

CREATE TRIGGER execution_step_result_payloads_immutable
  BEFORE UPDATE ON public.execution_step_result_payloads
  FOR EACH ROW EXECUTE FUNCTION public.prevent_execution_step_result_payload_mutation();

ALTER TABLE public.execution_step_result_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_step_result_payloads FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.execution_step_result_payloads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.execution_step_result_payloads TO service_role;
REVOKE ALL ON FUNCTION public.prevent_execution_step_result_payload_mutation() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.execution_step_result_payloads IS
  'Immutable, bounded JSON results owned by one execution run and source step; internal store access only, with no direct client lookup.';
COMMENT ON COLUMN public.execution_steps.result_payload_id IS
  'Internal linkage for a large result payload; callers receive the validated dereferenced ExecutionStepResult.';
