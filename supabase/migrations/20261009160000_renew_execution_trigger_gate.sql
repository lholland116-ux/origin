BEGIN;

CREATE FUNCTION public.renew_agent_execution_trigger_gate(p_claim_id uuid, p_fencing_generation bigint)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_renewed integer;
BEGIN
  IF p_claim_id IS NULL OR p_fencing_generation IS NULL OR p_fencing_generation < 1 THEN
    RETURN false;
  END IF;

  UPDATE public.agent_execution_trigger_gate AS gate
  SET lease_until = pg_catalog.clock_timestamp() + interval '150 seconds'
  WHERE gate.singleton
    AND gate.claim_id = p_claim_id
    AND gate.fencing_generation = p_fencing_generation
    AND gate.lease_until > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS v_renewed = ROW_COUNT;
  RETURN v_renewed = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_agent_execution_trigger_gate(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_agent_execution_trigger_gate(uuid, bigint) TO service_role;

COMMENT ON FUNCTION public.renew_agent_execution_trigger_gate(uuid, bigint) IS
  'Extends only the current, unexpired fenced trigger-gate lease; expired/stale claims cannot resurrect ownership.';

COMMIT;
