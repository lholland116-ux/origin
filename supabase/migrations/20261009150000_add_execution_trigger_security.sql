BEGIN;

-- The trigger contains no customer identity. Its nonce and the global dispatch
-- gate are private coordination records; all scheduling authority remains in
-- the existing accepted-run and per-run claim tables.
CREATE TABLE public.agent_execution_trigger_nonces (
  nonce_sha256 text PRIMARY KEY CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TABLE public.agent_execution_trigger_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  claim_id uuid,
  fencing_generation bigint NOT NULL DEFAULT 0 CHECK (fencing_generation >= 0),
  lease_until timestamptz,
  CONSTRAINT agent_execution_trigger_gate_claim_pair CHECK (
    (claim_id IS NULL AND lease_until IS NULL) OR (claim_id IS NOT NULL AND lease_until IS NOT NULL)
  )
);

INSERT INTO public.agent_execution_trigger_gate (singleton) VALUES (true);

ALTER TABLE public.agent_execution_trigger_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_execution_trigger_nonces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_execution_trigger_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_execution_trigger_gate FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_execution_trigger_nonces FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.agent_execution_trigger_gate FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX agent_execution_trigger_nonces_expiry_idx
  ON public.agent_execution_trigger_nonces (expires_at);

CREATE FUNCTION public.consume_agent_execution_trigger_nonce(p_nonce_sha256 text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inserted integer;
BEGIN
  IF p_nonce_sha256 IS NULL OR p_nonce_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EXECUTION_TRIGGER_NONCE';
  END IF;

  DELETE FROM public.agent_execution_trigger_nonces
  WHERE expires_at <= pg_catalog.clock_timestamp();

  INSERT INTO public.agent_execution_trigger_nonces (nonce_sha256, expires_at)
  VALUES (p_nonce_sha256, pg_catalog.clock_timestamp() + interval '10 minutes')
  ON CONFLICT (nonce_sha256) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$function$;

CREATE FUNCTION public.acquire_agent_execution_trigger_gate(p_claim_id uuid)
RETURNS TABLE(status text, fencing_generation bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_generation bigint;
BEGIN
  IF p_claim_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EXECUTION_TRIGGER_CLAIM';
  END IF;

  UPDATE public.agent_execution_trigger_gate AS gate
  SET claim_id = p_claim_id,
      fencing_generation = gate.fencing_generation + 1,
      lease_until = pg_catalog.clock_timestamp() + interval '150 seconds'
  WHERE gate.singleton
    AND (gate.claim_id IS NULL OR gate.lease_until <= pg_catalog.clock_timestamp())
  RETURNING gate.fencing_generation INTO v_generation;

  IF v_generation IS NULL THEN
    RETURN QUERY SELECT 'busy'::text, NULL::bigint;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'acquired'::text, v_generation;
END;
$function$;

CREATE FUNCTION public.release_agent_execution_trigger_gate(p_claim_id uuid, p_fencing_generation bigint)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_released integer;
BEGIN
  IF p_claim_id IS NULL OR p_fencing_generation IS NULL OR p_fencing_generation < 1 THEN
    RETURN false;
  END IF;
  UPDATE public.agent_execution_trigger_gate AS gate
  SET claim_id = NULL, lease_until = NULL
  WHERE gate.singleton AND gate.claim_id = p_claim_id
    AND gate.fencing_generation = p_fencing_generation;
  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_agent_execution_trigger_nonce(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_agent_execution_trigger_gate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_agent_execution_trigger_gate(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_agent_execution_trigger_nonce(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_agent_execution_trigger_gate(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_agent_execution_trigger_gate(uuid, bigint) TO service_role;

COMMENT ON TABLE public.agent_execution_trigger_nonces IS
  'Hashed, short-lived HMAC wake-up nonces; contains no credential and is only mutable through service-role RPC.';
COMMENT ON TABLE public.agent_execution_trigger_gate IS
  'Single global bounded worker-invocation lease; it serializes wake-ups but does not authorize any run or step.';
COMMENT ON FUNCTION public.acquire_agent_execution_trigger_gate(uuid) IS
  'Atomically admits one wake-up for at most 150 seconds; PostgreSQL run claims and fencing remain authoritative.';

COMMIT;
