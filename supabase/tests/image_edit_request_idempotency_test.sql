BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(146);

-- Schema and access boundary.
SELECT has_table(
  'public',
  'image_edit_requests',
  'image-edit idempotency table exists'
);

SELECT has_pk(
  'public',
  'image_edit_requests',
  'image-edit idempotency table has a primary key'
);

SELECT col_type_is('public', 'image_edit_requests', 'id', 'uuid', 'request identity is UUID');
SELECT col_type_is('public', 'image_edit_requests', 'user_id', 'uuid', 'request stores tenant identity');
SELECT col_type_is('public', 'image_edit_requests', 'conversation_id', 'uuid', 'request stores conversation identity');
SELECT col_type_is('public', 'image_edit_requests', 'idempotency_key', 'uuid', 'request key is UUID');
SELECT col_type_is('public', 'image_edit_requests', 'request_fingerprint', 'text', 'request fingerprint is text');
SELECT col_type_is('public', 'image_edit_requests', 'status', 'text', 'request status is text');
SELECT col_type_is('public', 'image_edit_requests', 'attempt_id', 'uuid', 'request may bind an image attempt');
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.claim_image_edit_request(uuid,uuid,text)'::regprocedure
      AND proretset
      AND proargnames[4:11] = ARRAY[
        'image_edit_request_id',
        'disposition',
        'attempt_id',
        'stale_attempt_id',
        'user_message_id',
        'assistant_message_id',
        'generated_image_id',
        'status'
      ]::text[]
      AND proargmodes[4:11] = ARRAY['t', 't', 't', 't', 't', 't', 't', 't']::"char"[]
      AND proallargtypes[4:11] = ARRAY[
        'uuid'::regtype::oid,
        'text'::regtype::oid,
        'uuid'::regtype::oid,
        'uuid'::regtype::oid,
        'uuid'::regtype::oid,
        'uuid'::regtype::oid,
        'uuid'::regtype::oid,
        'text'::regtype::oid
      ]::oid[]
  ),
  'claim RPC exposes the exact ordered UUID/text return contract'
);
SELECT col_type_is('public', 'image_edit_requests', 'user_message_id', 'uuid', 'request may bind its user message');
SELECT col_type_is('public', 'image_edit_requests', 'assistant_message_id', 'uuid', 'request may bind its assistant message');
SELECT col_type_is('public', 'image_edit_requests', 'generated_image_id', 'uuid', 'request may bind its generated image');
SELECT col_type_is('public', 'image_edit_requests', 'claim_expires_at', 'timestamp with time zone', 'request claim has a timestamptz lease');
SELECT col_type_is('public', 'image_edit_requests', 'failure_code', 'text', 'request failure code is text');
SELECT col_type_is('public', 'image_edit_requests', 'retry_count', 'integer', 'request retry count is integer');
SELECT col_type_is('public', 'image_edit_requests', 'created_at', 'timestamp with time zone', 'request creation time is timestamptz');
SELECT col_type_is('public', 'image_edit_requests', 'updated_at', 'timestamp with time zone', 'request update time is timestamptz');
SELECT col_type_is('public', 'image_edit_requests', 'completed_at', 'timestamp with time zone', 'completion time is timestamptz');
SELECT col_type_is('public', 'image_edit_requests', 'failed_at', 'timestamp with time zone', 'failure time is timestamptz');

SELECT col_has_default('public', 'image_edit_requests', 'id', 'request IDs default to gen_random_uuid');
SELECT col_has_default('public', 'image_edit_requests', 'retry_count', 'request retries default to zero');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND conname = 'image_edit_requests_user_id_idempotency_key_key'
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, idempotency_key)'
  ),
  'uniqueness is scoped exactly to user and explicit idempotency key'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND conname = 'image_edit_requests_status_check'
      AND pg_get_constraintdef(oid) ILIKE '%in_progress%'
      AND pg_get_constraintdef(oid) ILIKE '%failed%'
      AND pg_get_constraintdef(oid) ILIKE '%completed%'
  ),
  'status is constrained to the three idempotency lifecycle states'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND conname = 'image_edit_requests_fingerprint_check'
      AND pg_get_constraintdef(oid) ILIKE '%[0-9a-f]%'
  ),
  'request fingerprints use the lowercase SHA-256-style shape check'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND conname = 'image_edit_requests_retry_count_check'
      AND pg_get_constraintdef(oid) ILIKE '%>= 0%'
  ),
  'retry count cannot be negative'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND conname = 'image_edit_requests_lifecycle_check'
      AND pg_get_constraintdef(oid) ILIKE '%failed_at%'
      AND pg_get_constraintdef(oid) ILIKE '%completed_at%'
  ),
  'status timestamps and controlled failure codes have lifecycle checks'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND conname = 'image_edit_requests_claim_lease_check'
      AND pg_get_constraintdef(oid) ILIKE '%claim_expires_at%'
      AND pg_get_constraintdef(oid) ILIKE '%updated_at%'
  ),
  'active claims require a meaningful lease'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.image_edit_requests'::regclass),
  'idempotency table has row-level security enabled'
);

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.image_edit_requests'::regclass),
  'idempotency table forces row-level security'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND conname = 'image_edit_requests_user_id_fkey'
      AND confrelid = 'auth.users'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%on delete cascade%'
  ),
  'request tenant deletion cascades idempotency rows'
);

SELECT ok(
  (
    SELECT count(*) = 5
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND contype = 'f'
      AND confrelid IN (
        'public.conversations'::regclass,
        'public.image_generation_attempts'::regclass,
        'public.messages'::regclass,
        'public.message_generated_images'::regclass
      )
  ),
  'request references conversations, attempts, messages, and generated images'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND conname = 'image_edit_requests_conversation_id_fkey'
      AND pg_get_constraintdef(oid) ILIKE '%on delete cascade%'
  )
  AND (
    SELECT count(*) = 4
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.image_edit_requests'::regclass
      AND contype = 'f'
      AND confrelid IN (
        'public.image_generation_attempts'::regclass,
        'public.messages'::regclass,
        'public.message_generated_images'::regclass
      )
      AND pg_get_constraintdef(oid) ILIKE '%on delete set null%'
  ),
  'operational and result references detach when their rows are deleted'
);

SELECT ok(not has_table_privilege('authenticated', 'public.image_edit_requests', 'SELECT'), 'authenticated clients cannot read claims directly');
SELECT ok(not has_table_privilege('authenticated', 'public.image_edit_requests', 'INSERT'), 'authenticated clients cannot insert claims directly');
SELECT ok(not has_table_privilege('authenticated', 'public.image_edit_requests', 'UPDATE'), 'authenticated clients cannot update claims directly');
SELECT ok(not has_table_privilege('authenticated', 'public.image_edit_requests', 'DELETE'), 'authenticated clients cannot delete claims directly');
SELECT ok(has_table_privilege('service_role', 'public.image_edit_requests', 'UPDATE'), 'trusted server infrastructure may update claims');

SELECT has_function('public', 'claim_image_edit_request', array['uuid', 'uuid', 'text'], 'claim RPC exists');
SELECT has_function('public', 'bind_image_edit_request_attempt', array['uuid', 'uuid'], 'attempt binding RPC exists');
SELECT has_function('public', 'fail_image_edit_request', array['uuid', 'text'], 'failure RPC exists');

SELECT ok(has_function_privilege('authenticated', 'public.claim_image_edit_request(uuid,uuid,text)', 'EXECUTE'), 'authenticated clients may claim through the RPC');
SELECT ok(has_function_privilege('authenticated', 'public.bind_image_edit_request_attempt(uuid,uuid)', 'EXECUTE'), 'authenticated clients may bind through the RPC');
SELECT ok(has_function_privilege('authenticated', 'public.fail_image_edit_request(uuid,text)', 'EXECUTE'), 'authenticated clients may fail through the RPC');
SELECT ok(not has_function_privilege('anon', 'public.claim_image_edit_request(uuid,uuid,text)', 'EXECUTE'), 'anonymous clients cannot claim image edits');
SELECT ok(not has_function_privilege('anon', 'public.bind_image_edit_request_attempt(uuid,uuid)', 'EXECUTE'), 'anonymous clients cannot bind image-edit attempts');
SELECT ok(not has_function_privilege('anon', 'public.fail_image_edit_request(uuid,text)', 'EXECUTE'), 'anonymous clients cannot fail image-edit requests');

SELECT ok((SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.claim_image_edit_request(uuid,uuid,text)'::regprocedure), 'claim RPC is security definer');
SELECT ok((SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.bind_image_edit_request_attempt(uuid,uuid)'::regprocedure), 'binding RPC is security definer');
SELECT ok((SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = 'public.fail_image_edit_request(uuid,text)'::regprocedure), 'failure RPC is security definer');

SELECT ok(
  lower(pg_get_functiondef('public.claim_image_edit_request(uuid,uuid,text)'::regprocedure)) LIKE '%auth.uid()%'
  AND lower(pg_get_functiondef('public.claim_image_edit_request(uuid,uuid,text)'::regprocedure)) LIKE '%pg_advisory_xact_lock%'
  AND lower(pg_get_functiondef('public.claim_image_edit_request(uuid,uuid,text)'::regprocedure)) LIKE '%search_path%'
  AND lower(pg_get_function_arguments('public.claim_image_edit_request(uuid,uuid,text)'::regprocedure)) NOT LIKE '%user_id%',
  'claim RPC derives identity from auth.uid and uses a hardened serialized function'
);

SELECT ok(
  lower(pg_get_functiondef('public.bind_image_edit_request_attempt(uuid,uuid)'::regprocedure)) LIKE '%auth.uid()%'
  AND lower(pg_get_functiondef('public.bind_image_edit_request_attempt(uuid,uuid)'::regprocedure)) LIKE '%search_path%'
  AND lower(pg_get_function_arguments('public.bind_image_edit_request_attempt(uuid,uuid)'::regprocedure)) NOT LIKE '%user_id%',
  'binding RPC derives identity from auth.uid and uses a hardened function'
);

SELECT ok(
  lower(pg_get_functiondef('public.fail_image_edit_request(uuid,text)'::regprocedure)) LIKE '%auth.uid()%'
  AND lower(pg_get_functiondef('public.fail_image_edit_request(uuid,text)'::regprocedure)) LIKE '%search_path%'
  AND lower(pg_get_function_arguments('public.fail_image_edit_request(uuid,text)'::regprocedure)) NOT LIKE '%user_id%',
  'failure RPC derives identity from auth.uid and uses a hardened function'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'complete_image_edit_request'
  ),
  'no standalone completion RPC is created in the foundation migration'
);

-- Fixtures are created outside the browser role. RPC calls below derive the
-- tenant solely from the JWT subject claim.
INSERT INTO auth.users (id, aud, role, email)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'idempotency-owner@example.test'),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'idempotency-other@example.test');

INSERT INTO public.conversations (id, user_id, title)
VALUES
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Idempotency owner'),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Idempotency other'),
  ('b1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'Idempotency owner alternate');

INSERT INTO public.messages (id, conversation_id, user_id, role, content, documents)
VALUES
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'user', 'image edit instruction', '[]'::jsonb),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'assistant', '', '[]'::jsonb);

INSERT INTO public.message_generated_images (
  id, message_id, conversation_id, user_id, storage_path, mime_type, provider, model
)
VALUES (
  'd1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/idempotency.webp',
  'image/webp',
  'test-provider',
  'test-model'
);

INSERT INTO public.image_generation_attempts (
  id, user_id, conversation_id, plan_snapshot, status, reserved_at,
  expires_at, provider_started_at, provider, model, estimated_cost_microusd
)
VALUES
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('e1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('e1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('e1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '2 hours', now() - interval '1 hour', now() - interval '90 minutes', 'test-provider', 'test-model', 0),
  ('e1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0);

INSERT INTO public.image_generation_attempts (
  id, user_id, conversation_id, plan_snapshot, status, reserved_at,
  expires_at, provider_started_at, provider, model, estimated_cost_microusd,
  released_at, release_reason
)
VALUES (
  'e1000000-0000-4000-8000-000000000007',
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'free',
  'released',
  now() - interval '2 hours',
  now() + interval '10 minutes',
  NULL,
  NULL,
  NULL,
  0,
  now() - interval '90 minutes',
  'provider_failure'
);

INSERT INTO public.image_generation_attempts (
  id, user_id, conversation_id, plan_snapshot, status, reserved_at,
  expires_at, provider_started_at, provider, model, estimated_cost_microusd,
  completed_at
)
VALUES
  (
    'e1000000-0000-4000-8000-000000000008',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'free',
    'reserved',
    now() - interval '1 minute',
    now() + interval '10 minutes',
    now() - interval '30 seconds',
    'test-provider',
    'test-model',
    0,
    NULL
  ),
  (
    'e1000000-0000-4000-8000-000000000009',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'free',
    'succeeded',
    now() - interval '2 hours',
    now() - interval '1 hour',
    now() - interval '90 minutes',
    'test-provider',
    'test-model',
    0,
    now() - interval '60 minutes'
  ),
  (
    'e1000000-0000-4000-8000-000000000010',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'free',
    'reserved',
    now() - interval '1 minute',
    now() + interval '10 minutes',
    now() - interval '30 seconds',
    'test-provider',
    'test-model',
    0,
    NULL
  );

INSERT INTO public.image_edit_requests (
  id, user_id, conversation_id, idempotency_key, request_fingerprint, status,
  attempt_id, user_message_id, assistant_message_id, generated_image_id,
  claim_expires_at, failure_code, retry_count, created_at, updated_at,
  completed_at, failed_at
)
VALUES
  (
    'f1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000001',
    repeat('1', 64),
    'completed',
    'e1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    now() + interval '10 minutes',
    NULL,
    0,
    now() - interval '2 hours',
    now() - interval '2 hours',
    now() - interval '90 minutes',
    NULL
  ),
  (
    'f1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000002',
    repeat('2', 64),
    'failed',
    'e1000000-0000-4000-8000-000000000001',
    NULL,
    NULL,
    NULL,
    now() - interval '90 minutes',
    'provider_failure',
    2,
    now() - interval '2 hours',
    now() - interval '2 hours',
    NULL,
    now() - interval '90 minutes'
  ),
  (
    'f1000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000003',
    repeat('3', 64),
    'in_progress',
    'e1000000-0000-4000-8000-000000000005',
    NULL,
    NULL,
    NULL,
    now() - interval '1 minute',
    NULL,
    0,
    now() - interval '2 hours',
    now() - interval '2 hours',
    NULL,
    NULL
  ),
  (
    'f1000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000004',
    repeat('4', 64),
    'in_progress',
    NULL,
    NULL,
    NULL,
    NULL,
    now() + interval '10 minutes',
    NULL,
    0,
    now() - interval '1 minute',
    now() - interval '1 minute',
    NULL,
    NULL
  ),
  (
    'f1000000-0000-4000-8000-000000000014',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000014',
    repeat('e', 64),
    'failed',
    'e1000000-0000-4000-8000-000000000007',
    NULL,
    NULL,
    NULL,
    now() - interval '90 minutes',
    'provider_failure',
    0,
    now() - interval '2 hours',
    now() - interval '90 minutes',
    NULL,
    now() - interval '90 minutes'
  ),
  (
    'f1000000-0000-4000-8000-000000000016',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000016',
    repeat('1', 64),
    'in_progress',
    'e1000000-0000-4000-8000-000000000007',
    NULL,
    NULL,
    NULL,
    now() + interval '10 minutes',
    NULL,
    0,
    now() - interval '1 minute',
    now() - interval '1 minute',
    NULL,
    NULL
  ),
  (
    'f1000000-0000-4000-8000-000000000017',
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000017',
    repeat('1', 64),
    'in_progress',
    'e1000000-0000-4000-8000-000000000009',
    NULL,
    NULL,
    NULL,
    now() + interval '10 minutes',
    NULL,
    0,
    now() - interval '1 minute',
    now() - interval '1 minute',
    NULL,
    NULL
  );

-- Completed lifecycle constraints reject incomplete or contradictory terminal
-- rows while accepting the future CS5D shape, including durable result IDs.
SELECT throws_ok(
  $$INSERT INTO public.image_edit_requests (
    user_id, conversation_id, idempotency_key, request_fingerprint, status,
    claim_expires_at
  ) VALUES (
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000010',
    repeat('a', 64),
    'completed',
    now() + interval '10 minutes'
  )$$,
  '23514',
  NULL::text,
  'completed rows require completed_at'
);

SELECT throws_ok(
  $$INSERT INTO public.image_edit_requests (
    user_id, conversation_id, idempotency_key, request_fingerprint, status,
    claim_expires_at, completed_at, failure_code
  ) VALUES (
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000011',
    repeat('b', 64),
    'completed',
    now() + interval '10 minutes',
    now(),
    'provider_failure'
  )$$,
  '23514',
  NULL::text,
  'completed rows cannot retain failure_code'
);

SELECT throws_ok(
  $$INSERT INTO public.image_edit_requests (
    user_id, conversation_id, idempotency_key, request_fingerprint, status,
    claim_expires_at, completed_at, failed_at
  ) VALUES (
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000012',
    repeat('c', 64),
    'completed',
    now() + interval '10 minutes',
    now(),
    now()
  )$$,
  '23514',
  NULL::text,
  'completed rows cannot retain failed_at'
);

INSERT INTO public.image_edit_requests (
  id, user_id, conversation_id, idempotency_key, request_fingerprint, status,
  attempt_id, user_message_id, assistant_message_id, generated_image_id,
  claim_expires_at, retry_count, completed_at
)
VALUES (
  'f1000000-0000-4000-8000-000000000013',
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000013',
  repeat('d', 64),
  'completed',
  'e1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  now() + interval '10 minutes',
  0,
  now()
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.image_edit_requests
    WHERE id = 'f1000000-0000-4000-8000-000000000013'
      AND status = 'completed'
      AND completed_at IS NOT NULL
      AND failure_code IS NULL
      AND failed_at IS NULL
      AND attempt_id = 'e1000000-0000-4000-8000-000000000001'::uuid
      AND generated_image_id = 'd1000000-0000-4000-8000-000000000001'::uuid
  ),
  'a valid completed operation may retain its attempt and result IDs'
);

-- Conversation deletion follows the existing application cleanup contract.
INSERT INTO public.conversations (id, user_id, title)
VALUES (
  'b1000000-0000-4000-8000-000000000004',
  'a1000000-0000-4000-8000-000000000001',
  'Idempotency deletion fixture'
);

INSERT INTO public.image_edit_requests (
  id, user_id, conversation_id, idempotency_key, request_fingerprint, status,
  claim_expires_at
)
VALUES (
  'f1000000-0000-4000-8000-000000000015',
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000004',
  'f2000000-0000-4000-8000-000000000015',
  repeat('f', 64),
  'in_progress',
  now() + interval '10 minutes'
);

DELETE FROM public.conversations
WHERE id = 'b1000000-0000-4000-8000-000000000004';

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.image_edit_requests
    WHERE id = 'f1000000-0000-4000-8000-000000000015'
  ),
  'conversation deletion cascades its idempotency rows'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT throws_ok(
  $$SELECT * FROM public.claim_image_edit_request(
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000005',
    repeat('5', 64)
  )$$,
  '42501',
  'UNAUTHORIZED',
  'unauthenticated claims are rejected'
);

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

CREATE TEMPORARY TABLE owner_new_claim ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000005',
  repeat('5', 64)
);

SELECT is((SELECT disposition FROM owner_new_claim), 'claimed', 'a new key is claimed');
SELECT is((SELECT status FROM owner_new_claim), 'in_progress', 'a new claim starts in progress');
SELECT is((SELECT stale_attempt_id FROM owner_new_claim), NULL::uuid, 'a new claim has no stale attempt handoff');
SET LOCAL ROLE postgres;
SELECT is((SELECT retry_count FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)), 0, 'a new claim starts with zero retries');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::integer FROM owner_new_claim), 1, 'a new claim returns one safe result row');

CREATE TEMPORARY TABLE owner_active_replay ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000005',
  repeat('5', 64)
);

SELECT is((SELECT disposition FROM owner_active_replay), 'in_progress', 'an active duplicate is not reclaimed');
SELECT is((SELECT image_edit_request_id FROM owner_active_replay), (SELECT image_edit_request_id FROM owner_new_claim), 'active replay returns the same request identity');
SELECT is((SELECT stale_attempt_id FROM owner_active_replay), NULL::uuid, 'active replay has no stale attempt handoff');

CREATE TEMPORARY TABLE owned_conversation_conflict ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000003',
  'f2000000-0000-4000-8000-000000000005',
  repeat('5', 64)
);

SELECT is((SELECT disposition FROM owned_conversation_conflict), 'conflict', 'the same key and fingerprint conflict in another owned conversation');
SET LOCAL ROLE postgres;
SELECT ok(
  (SELECT conversation_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)) = 'b1000000-0000-4000-8000-000000000001'::uuid
  AND (SELECT request_fingerprint FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)) = repeat('5', 64)
  AND (SELECT status FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)) = 'in_progress'
  AND (SELECT retry_count FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)) = 0
  AND (SELECT user_message_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)) IS NULL
  AND (SELECT assistant_message_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)) IS NULL
  AND (SELECT generated_image_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)) IS NULL,
  'owned conversation conflict leaves the original conversation, retry count, and result IDs unchanged'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

CREATE TEMPORARY TABLE owner_conflict ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000005',
  repeat('6', 64)
);

SELECT is((SELECT disposition FROM owner_conflict), 'conflict', 'reusing a key for another fingerprint conflicts');
SELECT is((SELECT stale_attempt_id FROM owner_conflict), NULL::uuid, 'conflict has no stale attempt handoff');
SET LOCAL ROLE postgres;
SELECT is((SELECT request_fingerprint FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM owner_new_claim)), repeat('5', 64), 'fingerprint conflict does not mutate the original row');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

CREATE TEMPORARY TABLE completed_replay ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  repeat('1', 64)
);

SELECT is((SELECT disposition FROM completed_replay), 'completed', 'completed operations return completed disposition');
SELECT is((SELECT stale_attempt_id FROM completed_replay), NULL::uuid, 'completed replay has no stale attempt handoff');
SELECT is((SELECT generated_image_id FROM completed_replay), 'd1000000-0000-4000-8000-000000000001'::uuid, 'completed replay returns the durable generated-image identity');
SET LOCAL ROLE postgres;
SELECT is((SELECT status FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM completed_replay)), 'completed', 'completed replay does not change terminal status');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

CREATE TEMPORARY TABLE failed_reclaim ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  repeat('2', 64)
);

SELECT is((SELECT disposition FROM failed_reclaim), 'claimed', 'failed operations can be reclaimed');
SET LOCAL ROLE postgres;
SELECT is((SELECT retry_count FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), 3, 'failed reclaim increments retry count once');
SELECT is((SELECT failure_code FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), NULL::text, 'failed reclaim clears the prior failure code');
SELECT is((SELECT failed_at FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), NULL::timestamptz, 'failed reclaim clears the prior failed_at timestamp');
SELECT is((SELECT completed_at FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), NULL::timestamptz, 'failed reclaim keeps completed_at NULL');
SELECT is((SELECT stale_attempt_id FROM failed_reclaim), 'e1000000-0000-4000-8000-000000000001'::uuid, 'failed reclaim returns the prior attempt as a stale handoff');
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), 'e1000000-0000-4000-8000-000000000001'::uuid, 'failed reclaim preserves the prior attempt binding for crash recovery');
SELECT is((SELECT request_fingerprint FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), repeat('2', 64), 'failed reclaim preserves the request fingerprint');
SELECT is((SELECT conversation_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), 'b1000000-0000-4000-8000-000000000001'::uuid, 'failed reclaim preserves the conversation identity');
SELECT is((SELECT idempotency_key FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), 'f2000000-0000-4000-8000-000000000002'::uuid, 'failed reclaim preserves the idempotency key');
SELECT is((SELECT user_message_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), NULL::uuid, 'failed reclaim leaves the user message result ID NULL');
SELECT is((SELECT assistant_message_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), NULL::uuid, 'failed reclaim leaves the assistant message result ID NULL');
SELECT is((SELECT generated_image_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failed_reclaim)), NULL::uuid, 'failed reclaim leaves the generated image result ID NULL');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

CREATE TEMPORARY TABLE expired_attempt_bind_claim ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000009',
  repeat('9', 64)
);

SELECT is((SELECT disposition FROM expired_attempt_bind_claim), 'claimed', 'expired-attempt binding fixture starts with a claim');
SELECT ok(
  NOT public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM expired_attempt_bind_claim),
    'e1000000-0000-4000-8000-000000000005'
  ),
  'expired reserved attempts cannot be bound'
);

CREATE TEMPORARY TABLE non_reserved_attempt_bind_claim ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000010',
  repeat('a', 64)
);

SELECT is((SELECT disposition FROM non_reserved_attempt_bind_claim), 'claimed', 'non-reserved-attempt binding fixture starts with a claim');
SELECT ok(
  NOT public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM non_reserved_attempt_bind_claim),
    'e1000000-0000-4000-8000-000000000007'
  ),
  'released attempts cannot be bound'
);

CREATE TEMPORARY TABLE expired_reclaim ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000003',
  repeat('3', 64)
);

SELECT is((SELECT disposition FROM expired_reclaim), 'claimed', 'expired in-progress operations can be reclaimed');
SET LOCAL ROLE postgres;
SELECT is((SELECT retry_count FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM expired_reclaim)), 1, 'expired reclaim increments retry count once');
SELECT is((SELECT stale_attempt_id FROM expired_reclaim), 'e1000000-0000-4000-8000-000000000005'::uuid, 'expired reclaim returns the prior attempt as a stale handoff');
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM expired_reclaim)), 'e1000000-0000-4000-8000-000000000005'::uuid, 'expired reclaim keeps the prior attempt discoverable after a crash');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT ok(
  public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM expired_reclaim),
    'e1000000-0000-4000-8000-000000000006'
  ),
  'a replacement may bind after the prior reserved attempt expires'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM expired_reclaim)), 'e1000000-0000-4000-8000-000000000006'::uuid, 'replacement binding atomically replaces the expired attempt');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

SELECT ok(
  public.bind_image_edit_request_attempt(
    'f1000000-0000-4000-8000-000000000016'::uuid,
    'e1000000-0000-4000-8000-000000000008'::uuid
  ),
  'a released prior attempt can be replaced'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = 'f1000000-0000-4000-8000-000000000016'), 'e1000000-0000-4000-8000-000000000008'::uuid, 'released-attempt replacement persists the new attempt identity');
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.image_generation_attempts
    WHERE id = 'e1000000-0000-4000-8000-000000000007'
      AND status = 'released'
      AND released_at IS NOT NULL
      AND release_reason = 'provider_failure'
  ),
  'released-attempt replacement preserves the prior attempt lifecycle'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

SELECT ok(
  public.bind_image_edit_request_attempt(
    'f1000000-0000-4000-8000-000000000017'::uuid,
    'e1000000-0000-4000-8000-000000000010'::uuid
  ),
  'a succeeded prior attempt can be replaced'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = 'f1000000-0000-4000-8000-000000000017'), 'e1000000-0000-4000-8000-000000000010'::uuid, 'succeeded-attempt replacement persists the new attempt identity');
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.image_generation_attempts
    WHERE id = 'e1000000-0000-4000-8000-000000000009'
      AND status = 'succeeded'
      AND completed_at IS NOT NULL
      AND released_at IS NULL
      AND release_reason IS NULL
  ),
  'succeeded-attempt replacement preserves the prior attempt lifecycle'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

CREATE TEMPORARY TABLE active_replay ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000004',
  repeat('4', 64)
);

SELECT is((SELECT disposition FROM active_replay), 'in_progress', 'non-expired in-progress operations cannot be reclaimed');
SET LOCAL ROLE postgres;
SELECT is((SELECT retry_count FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM active_replay)), 0, 'active operations do not increment retries');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

CREATE TEMPORARY TABLE same_fingerprint_different_key ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000006',
  repeat('5', 64)
);

SELECT is((SELECT disposition FROM same_fingerprint_different_key), 'claimed', 'different keys permit intentionally repeated logical inputs');
SET LOCAL ROLE postgres;
SELECT is((SELECT count(*)::integer FROM public.image_edit_requests WHERE user_id = 'a1000000-0000-4000-8000-000000000001' AND request_fingerprint = repeat('5', 64)), 2, 'identical fingerprints with different keys create separate operations');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);

CREATE TEMPORARY TABLE other_claim ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000005',
  repeat('5', 64)
);

SELECT is((SELECT disposition FROM other_claim), 'claimed', 'another user may independently use the same UUID key');

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

SELECT throws_ok(
  $$SELECT * FROM public.claim_image_edit_request(
    'b1000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000099',
    repeat('9', 64)
  )$$,
  'P0001',
  'CONVERSATION_NOT_FOUND',
  'foreign conversations are rejected without creating a claim'
);

SELECT throws_ok(
  $$SELECT * FROM public.claim_image_edit_request(
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000099',
    'not-a-sha256-fingerprint'
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_REQUEST',
  'invalid fingerprints are rejected before claiming'
);

-- A completed operation remains terminal when supported cleanup removes its
-- display/result entities. It is replayed as completed with unavailable IDs.
SET LOCAL ROLE postgres;
DELETE FROM public.message_generated_images
WHERE id = 'd1000000-0000-4000-8000-000000000001';
DELETE FROM public.messages
WHERE id = 'c1000000-0000-4000-8000-000000000002';

SELECT is((SELECT status FROM public.image_edit_requests WHERE id = 'f1000000-0000-4000-8000-000000000001'), 'completed', 'result deletion leaves the completed idempotency row terminal');
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.image_edit_requests
    WHERE id = 'f1000000-0000-4000-8000-000000000001'
      AND generated_image_id IS NULL
      AND assistant_message_id IS NULL
  ),
  'result deletion sets missing completed result IDs to NULL'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

CREATE TEMPORARY TABLE completed_result_deleted_replay ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  repeat('1', 64)
);

SELECT is((SELECT disposition FROM completed_result_deleted_replay), 'completed', 'deleted results do not cause a completed operation to rerun');
SELECT is((SELECT generated_image_id FROM completed_result_deleted_replay), NULL::uuid, 'completed replay reports a deleted generated image as unavailable');
SELECT is((SELECT assistant_message_id FROM completed_result_deleted_replay), NULL::uuid, 'completed replay reports a deleted assistant message as unavailable');

SET LOCAL ROLE postgres;
DELETE FROM public.image_generation_attempts
WHERE id = 'e1000000-0000-4000-8000-000000000007';

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.image_edit_requests
    WHERE id = 'f1000000-0000-4000-8000-000000000014'
  ),
  'deleting an attempt does not delete its idempotency row'
);
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = 'f1000000-0000-4000-8000-000000000014'), NULL::uuid, 'deleting an attempt sets its idempotency reference to NULL');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

SET LOCAL ROLE postgres;
SELECT is((SELECT count(*)::integer FROM public.image_edit_requests WHERE user_id = 'a1000000-0000-4000-8000-000000000001' AND idempotency_key = 'f2000000-0000-4000-8000-000000000005'), 1, 'one user and key cannot create duplicate rows');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

-- Attempt binding is ownership- and conversation-scoped and idempotent only
-- for the same attempt.
CREATE TEMPORARY TABLE bind_claim ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000007',
  repeat('7', 64)
);

SELECT is((SELECT disposition FROM bind_claim), 'claimed', 'binding test operation starts claimed');
SELECT ok(
  public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM bind_claim),
    'e1000000-0000-4000-8000-000000000001'
  ),
  'same-user same-conversation active attempt may bind'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM bind_claim)), 'e1000000-0000-4000-8000-000000000001'::uuid, 'binding persists the attempt identity');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT ok(
  public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM bind_claim),
    'e1000000-0000-4000-8000-000000000001'
  ),
  'rebinding the same attempt is idempotent'
);
SELECT ok(
  NOT public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM bind_claim),
    'e1000000-0000-4000-8000-000000000004'
  ),
  'a different attempt cannot replace the first binding'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM bind_claim)), 'e1000000-0000-4000-8000-000000000001'::uuid, 'a rejected replacement leaves the original binding intact');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT ok(
  NOT public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM bind_claim),
    'e1000000-0000-4000-8000-000000000002'
  ),
  'a cross-conversation attempt is rejected'
);
SELECT ok(
  NOT public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM bind_claim),
    'e1000000-0000-4000-8000-000000000003'
  ),
  'another user’s attempt is rejected'
);

-- Failure is a controlled active-claim transition and leaves quota release to
-- the existing image-generation quota RPC.
CREATE TEMPORARY TABLE failure_claim ON COMMIT DROP AS
SELECT *
FROM public.claim_image_edit_request(
  'b1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000008',
  repeat('8', 64)
);

SELECT ok(
  public.bind_image_edit_request_attempt(
    (SELECT image_edit_request_id FROM failure_claim),
    'e1000000-0000-4000-8000-000000000001'
  ),
  'failure test operation can retain its attempt linkage'
);
SELECT ok(
  public.fail_image_edit_request(
    (SELECT image_edit_request_id FROM failure_claim),
    'provider_failure'
  ),
  'an active operation can transition to failed'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT status FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failure_claim)), 'failed', 'failure transition persists failed status');
SELECT is((SELECT failure_code FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failure_claim)), 'provider_failure', 'failure transition persists the controlled code');
SELECT ok((SELECT failed_at IS NOT NULL FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failure_claim)), 'failure transition records failed_at');
SELECT is((SELECT attempt_id FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM failure_claim)), 'e1000000-0000-4000-8000-000000000001'::uuid, 'failure transition preserves attempt linkage for auditability');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT ok(
  NOT public.fail_image_edit_request(
    (SELECT image_edit_request_id FROM failure_claim),
    'provider_failure'
  ),
  'a failed operation cannot be failed a second time'
);
SELECT ok(
  NOT public.fail_image_edit_request(
    'f1000000-0000-4000-8000-000000000001',
    'provider_failure'
  ),
  'a completed operation cannot be changed to failed'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT status FROM public.image_edit_requests WHERE id = 'f1000000-0000-4000-8000-000000000001'), 'completed', 'completed status remains terminal');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT ok(
  NOT public.fail_image_edit_request(
    (SELECT image_edit_request_id FROM other_claim),
    'provider_failure'
  ),
  'a foreign operation cannot be failed'
);
SET LOCAL ROLE postgres;
SELECT is((SELECT status FROM public.image_edit_requests WHERE id = (SELECT image_edit_request_id FROM other_claim)), 'in_progress', 'foreign failure leaves the other user operation unchanged');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

SELECT throws_ok(
  $$SELECT public.fail_image_edit_request(
    (SELECT image_edit_request_id FROM failure_claim),
    'raw provider error: secret'
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_FAILURE_CODE',
  'raw failure text is rejected'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(
  $$SELECT public.fail_image_edit_request(
    'f1000000-0000-4000-8000-000000000001',
    'provider_failure'
  )$$,
  '42501',
  'UNAUTHORIZED',
  'unauthenticated failure transitions are rejected'
);

-- The browser role has no direct table privileges; all request access is via
-- the three controlled RPCs.
SELECT throws_ok(
  $$SELECT * FROM public.image_edit_requests WHERE id = 'f1000000-0000-4000-8000-000000000001'$$,
  '42501',
  NULL::text,
  'authenticated clients cannot select idempotency rows directly'
);

SELECT throws_ok(
  $$INSERT INTO public.image_edit_requests (id) VALUES ('f1000000-0000-4000-8000-000000000099')$$,
  '42501',
  NULL::text,
  'authenticated clients cannot insert idempotency rows directly'
);

SELECT throws_ok(
  $$UPDATE public.image_edit_requests SET retry_count = retry_count WHERE id = 'f1000000-0000-4000-8000-000000000001'$$,
  '42501',
  NULL::text,
  'authenticated clients cannot update idempotency rows directly'
);

SELECT throws_ok(
  $$DELETE FROM public.image_edit_requests WHERE id = 'f1000000-0000-4000-8000-000000000001'$$,
  '42501',
  NULL::text,
  'authenticated clients cannot delete idempotency rows directly'
);

SELECT * FROM finish();

ROLLBACK;
