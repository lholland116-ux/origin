BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(32);

SELECT has_table('public', 'agent_request_acceptances', 'durable request-acceptance ledger exists');
SELECT has_function(
  'public', 'accept_agent_request',
  ARRAY['uuid', 'uuid', 'text', 'text', 'jsonb', 'text', 'uuid[]', 'jsonb', 'date', 'integer', 'integer'],
  'atomic acceptance RPC exists'
);
SELECT ok(
  (SELECT prosecdef FROM pg_catalog.pg_proc
   WHERE oid = 'public.accept_agent_request(uuid,uuid,text,text,jsonb,text,uuid[],jsonb,date,integer,integer)'::regprocedure),
  'acceptance runs in a fixed definer context'
);
SELECT ok(
  has_function_privilege('service_role', 'public.accept_agent_request(uuid,uuid,text,text,jsonb,text,uuid[],jsonb,date,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.accept_agent_request(uuid,uuid,text,text,jsonb,text,uuid[],jsonb,date,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.accept_agent_request(uuid,uuid,text,text,jsonb,text,uuid[],jsonb,date,integer,integer)', 'EXECUTE')
  AND NOT coalesce((
    SELECT bool_or(acl.privilege_type = 'EXECUTE')
    FROM pg_catalog.pg_proc procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
    WHERE procedure.oid = 'public.accept_agent_request(uuid,uuid,text,text,jsonb,text,uuid[],jsonb,date,integer,integer)'::regprocedure
      AND acl.grantee = 0
  ), false),
  'only the trusted service-role caller can invoke acceptance'
);
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.agent_request_acceptances'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.agent_request_acceptances', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.agent_request_acceptances', 'SELECT'),
  'the ledger is forced-RLS and has no direct API/table access'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.agent_request_acceptances'::regclass
      AND tgname = 'agent_request_acceptances_immutable'
      AND NOT tgisinternal),
  'accepted identity has an immutable-row trigger'
);

INSERT INTO auth.users (id, aud, role, email)
VALUES
  ('a3100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'accept-owner@example.test'),
  ('a3100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'accept-other@example.test');
INSERT INTO public.conversations (id, user_id, title)
VALUES
  ('b3100000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'Acceptance owner'),
  ('b3100000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000002', 'Acceptance other');

WITH first_response AS MATERIALIZED (
  SELECT public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001',
    'acceptance-pgtap-main', repeat('a', 64), '{"routingMode":"auto"}'::jsonb,
    'Analyze the uploaded report.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 3, 10
  ) AS result
)
SELECT ok(
  (result->>'kind') = 'accepted' AND (result->>'replayed') = 'false',
  'first submission is accepted and marked as non-replay'
)
FROM first_response;
SELECT is((SELECT count(*)::integer FROM public.agent_request_acceptances WHERE user_id = 'a3100000-0000-4000-8000-000000000001'), 1, 'first submission creates one ledger row');
SELECT is((SELECT message_count FROM public.usage WHERE user_id = 'a3100000-0000-4000-8000-000000000001' AND date = current_date), 1, 'first submission reserves daily usage once');
SELECT is((SELECT count(*)::integer FROM public.messages WHERE user_id = 'a3100000-0000-4000-8000-000000000001' AND role = 'user'), 1, 'first submission inserts one user message');
SELECT is((SELECT count(*)::integer FROM public.messages WHERE user_id = 'a3100000-0000-4000-8000-000000000001' AND role = 'assistant'), 1, 'first submission inserts one assistant destination');
SELECT ok(
  EXISTS (SELECT 1 FROM public.agent_request_acceptances acceptance
    JOIN public.messages assistant ON assistant.id = acceptance.assistant_message_id
    JOIN public.messages user_message ON user_message.id = acceptance.user_message_id
    WHERE acceptance.idempotency_key = 'acceptance-pgtap-main'
      AND assistant.content = '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:' || acceptance.request_id::text || ':' || user_message.id::text || ']]'
      AND assistant.created_at >= user_message.created_at),
  'accepted binding uses the existing hidden, ordered assistant destination convention'
);

SELECT is(
  (public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001',
    'acceptance-pgtap-main', repeat('a', 64), '{"routingMode":"auto"}'::jsonb,
    'Analyze the uploaded report.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 3, 10
  )->>'replayed'),
  'true', 'identical retry returns the original acceptance'
);
SELECT is(
  (SELECT request_id::text FROM public.agent_request_acceptances WHERE idempotency_key = 'acceptance-pgtap-main'),
  (public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001',
    'acceptance-pgtap-main', repeat('a', 64), '{"routingMode":"auto"}'::jsonb,
    'Analyze the uploaded report.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 3, 10
  )->>'requestId'), 'retry preserves request ID'
);
SELECT is(
  (SELECT user_message_id::text FROM public.agent_request_acceptances WHERE idempotency_key = 'acceptance-pgtap-main'),
  (public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001',
    'acceptance-pgtap-main', repeat('a', 64), '{"routingMode":"auto"}'::jsonb,
    'Analyze the uploaded report.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 3, 10
  )->>'userMessageId'), 'retry preserves user-message ID'
);
SELECT is(
  (SELECT assistant_message_id::text FROM public.agent_request_acceptances WHERE idempotency_key = 'acceptance-pgtap-main'),
  (public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001',
    'acceptance-pgtap-main', repeat('a', 64), '{"routingMode":"auto"}'::jsonb,
    'Analyze the uploaded report.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 3, 10
  )->>'assistantMessageId'), 'retry preserves assistant-message ID'
);
SELECT is((SELECT message_count FROM public.usage WHERE user_id = 'a3100000-0000-4000-8000-000000000001' AND date = current_date), 1, 'identical retry does not reserve usage again');
SELECT is((SELECT count(*)::integer FROM public.messages WHERE user_id = 'a3100000-0000-4000-8000-000000000001'), 2, 'identical retry creates no duplicate messages');

SELECT throws_ok(
  $$SELECT public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001',
    'acceptance-pgtap-main', repeat('b', 64), '{"routingMode":"auto"}'::jsonb,
    'A conflicting request.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 3, 10
  )$$,
  'P0001', 'REQUEST_IDEMPOTENCY_CONFLICT', 'same key with a different fingerprint is rejected'
);
SELECT is((SELECT count(*)::integer FROM public.agent_request_acceptances WHERE user_id = 'a3100000-0000-4000-8000-000000000001'), 1, 'conflicting replay creates no ledger row');
SELECT is((SELECT message_count FROM public.usage WHERE user_id = 'a3100000-0000-4000-8000-000000000001' AND date = current_date), 1, 'conflicting replay does not change quota');

UPDATE public.usage SET message_count = 3
WHERE user_id = 'a3100000-0000-4000-8000-000000000001' AND date = current_date;
SELECT is(
  (public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001',
    'acceptance-pgtap-limited', repeat('c', 64), '{"routingMode":"auto"}'::jsonb,
    'Another request.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 3, 10
  )->>'kind'),
  'limit_reached', 'daily quota boundary rejects over-limit acceptance'
);
SELECT is((SELECT count(*)::integer FROM public.agent_request_acceptances WHERE idempotency_key = 'acceptance-pgtap-limited'), 0, 'quota rejection creates no ledger identity');
SELECT is((SELECT message_count FROM public.usage WHERE user_id = 'a3100000-0000-4000-8000-000000000001' AND date = current_date), 3, 'quota rejection does not increment usage');
SELECT throws_ok(
  $$SELECT public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000002',
    'acceptance-pgtap-foreign', repeat('d', 64), '{"routingMode":"auto"}'::jsonb,
    'Cross-owner request.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 3, 10
  )$$,
  'P0001', 'CONVERSATION_NOT_FOUND', 'conversation ownership is enforced'
);
SELECT is((SELECT count(*)::integer FROM public.agent_request_acceptances WHERE idempotency_key = 'acceptance-pgtap-foreign'), 0, 'foreign conversation creates no acceptance');

RESET ROLE;
CREATE FUNCTION public.er_cs5b1_fail_assistant_insert_for_test()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.role = 'assistant' AND current_setting('agent_acceptance.test_fail_assistant', true) = 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TEST_ASSISTANT_INSERT_FAILURE';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER er_cs5b1_test_assistant_insert_failure
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.er_cs5b1_fail_assistant_insert_for_test();
SELECT set_config('agent_acceptance.test_fail_assistant', 'true', true);
SELECT throws_ok(
  $$SELECT public.accept_agent_request(
    'a3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-000000000001',
    'acceptance-pgtap-rollback', repeat('e', 64), '{"routingMode":"auto"}'::jsonb,
    'Rollback this request.', ARRAY[]::uuid[], '[]'::jsonb, current_date, 10, 10
  )$$,
  'P0001', 'TEST_ASSISTANT_INSERT_FAILURE', 'assistant persistence failure aborts acceptance'
);
RESET ROLE;
SELECT is((SELECT message_count FROM public.usage WHERE user_id = 'a3100000-0000-4000-8000-000000000001' AND date = current_date), 3, 'failed transaction rolls back quota reservation');
SELECT is((SELECT count(*)::integer FROM public.agent_request_acceptances WHERE idempotency_key = 'acceptance-pgtap-rollback'), 0, 'failed transaction leaves no durable acceptance');
SELECT is((SELECT count(*)::integer FROM public.messages WHERE user_id = 'a3100000-0000-4000-8000-000000000001'), 2, 'failed transaction leaves no partial messages');
DROP TRIGGER er_cs5b1_test_assistant_insert_failure ON public.messages;
DROP FUNCTION public.er_cs5b1_fail_assistant_insert_for_test();

CREATE TEMP TABLE acceptance_binding_for_validation ON COMMIT DROP AS
SELECT request_id, conversation_id, user_message_id, assistant_message_id
FROM public.agent_request_acceptances
WHERE idempotency_key = 'acceptance-pgtap-main';
GRANT SELECT ON acceptance_binding_for_validation TO authenticated;
SELECT set_config('request.jwt.claim.sub', 'a3100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.validate_agent_request_message_binding(
    binding.request_id,
    binding.conversation_id,
    binding.user_message_id,
    binding.assistant_message_id
  ),
  'accepted message pair passes the existing binding validator'
)
FROM acceptance_binding_for_validation binding;
RESET ROLE;
SELECT throws_ok(
  $$UPDATE public.agent_request_acceptances
    SET request_options = '{"routingMode":"standard"}'::jsonb
    WHERE idempotency_key = 'acceptance-pgtap-main'$$,
  'P0001', 'Agent request acceptance identity is immutable', 'accepted request identity cannot be mutated'
);

SELECT * FROM finish();
ROLLBACK;
