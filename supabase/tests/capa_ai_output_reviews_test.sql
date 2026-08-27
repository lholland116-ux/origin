begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

set constraints all deferred;

-- ---------------------------------------------------------------------------
-- Schema and security controls
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'capa_ai_output_reviews',
  'governed AI-output human-review table exists'
);

select has_pk(
  'public',
  'capa_ai_output_reviews',
  'AI-output review table has a tenant-qualified primary key'
);

select col_type_is(
  'public',
  'capa_ai_output_reviews',
  'organization_id',
  'uuid',
  'review tenant identity uses UUID'
);

select col_type_is(
  'public',
  'capa_ai_output_reviews',
  'review_id',
  'uuid',
  'review identity uses UUID'
);

select col_type_is(
  'public',
  'capa_ai_output_reviews',
  'decision',
  'text',
  'review decision uses controlled text'
);

select col_type_is(
  'public',
  'capa_ai_output_reviews',
  'human_revision',
  'jsonb',
  'human revision uses structured JSON'
);

select col_type_is(
  'public',
  'capa_ai_output_reviews',
  'audit_event_id',
  'uuid',
  'review audit-event identity uses UUID'
);

select col_has_default(
  'public',
  'capa_ai_output_reviews',
  'created_at',
  'review persistence time has a database default'
);

select has_trigger(
  'public',
  'capa_ai_output_reviews',
  'capa_ai_output_reviews_reject_mutation',
  'human reviews have the immutable-record trigger'
);

select has_trigger(
  'public',
  'capa_ai_outputs',
  'capa_ai_outputs_reject_mutation',
  'governed AI outputs have the immutable-record trigger'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_ai_output_reviews'::regclass
  ),
  'review row-level security is enabled'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_ai_output_reviews'::regclass
  ),
  'review row-level security is forced'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_ai_outputs'::regclass
  ),
  'AI-output row-level security is forced'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.capa_ai_output_reviews',
    'SELECT'
  ),
  'anonymous clients cannot read AI-output reviews'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_ai_output_reviews',
    'SELECT'
  ),
  'authenticated browser clients cannot directly read reviews'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_ai_output_reviews',
    'INSERT'
  ),
  'authenticated browser clients cannot directly create reviews'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_ai_output_reviews',
    'SELECT'
  ),
  'service role can resolve governed reviews'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_ai_output_reviews',
    'INSERT'
  ),
  'service role can append governed reviews'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_ai_output_reviews',
    'UPDATE'
  ),
  'service role cannot rewrite governed reviews'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_ai_output_reviews',
    'DELETE'
  ),
  'service role cannot delete governed reviews'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_ai_outputs',
    'UPDATE'
  ),
  'service role cannot rewrite governed AI outputs'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_ai_outputs',
    'DELETE'
  ),
  'service role cannot delete governed AI outputs'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_output_reviews'::regclass
      and conname =
        'capa_ai_output_reviews_idempotency_unique'
      and contype = 'u'
  ),
  'review idempotency is unique within an organization'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_output_reviews'::regclass
      and conname =
        'capa_ai_output_reviews_output_snapshot_fk'
      and contype = 'f'
  ),
  'review is foreign-key bound to the exact AI-output snapshot'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_output_reviews'::regclass
      and conname =
        'capa_ai_output_reviews_audit_event_fk'
      and contype = 'f'
      and condeferrable
      and condeferred
  ),
  'review-to-audit linkage is transactionally deferred'
);

-- ---------------------------------------------------------------------------
-- Controlled tenant fixtures
-- ---------------------------------------------------------------------------

insert into public.capa_organizations (
  organization_id,
  organization_name,
  authorization_policy_version,
  effective_at,
  created_at,
  created_by_actor_type,
  created_by_actor_id,
  updated_at,
  updated_by_actor_type,
  updated_by_actor_id
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'AI Review Test Organization A',
    'policy-test-1.0.0',
    '2026-08-26T17:00:00Z',
    '2026-08-26T17:00:00Z',
    'system',
    'database-test',
    '2026-08-26T17:00:00Z',
    'system',
    'database-test'
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    'AI Review Test Organization B',
    'policy-test-1.0.0',
    '2026-08-26T17:00:00Z',
    '2026-08-26T17:00:00Z',
    'system',
    'database-test',
    '2026-08-26T17:00:00Z',
    'system',
    'database-test'
  );

insert into public.capa_organization_memberships (
  membership_id,
  organization_id,
  user_id,
  status,
  effective_at,
  created_at,
  created_by_actor_type,
  created_by_actor_id,
  updated_at,
  updated_by_actor_type,
  updated_by_actor_id
)
values
  (
    'a1000000-0000-4000-8000-000000000011',
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'active',
    '2026-08-26T17:00:00Z',
    '2026-08-26T17:00:00Z',
    'system',
    'database-test',
    '2026-08-26T17:00:00Z',
    'system',
    'database-test'
  ),
  (
    'b1000000-0000-4000-8000-000000000011',
    'b1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    'active',
    '2026-08-26T17:00:00Z',
    '2026-08-26T17:00:00Z',
    'system',
    'database-test',
    '2026-08-26T17:00:00Z',
    'system',
    'database-test'
  );

insert into public.capa_cases (
  capa_case_id,
  organization_id,
  case_number,
  current_version_id,
  status,
  owner_user_id,
  confidentiality,
  record_version,
  effective_at,
  created_at,
  created_by_actor_type,
  created_by_actor_id,
  updated_at,
  updated_by_actor_type,
  updated_by_actor_id
)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'CAPA-AI-REVIEW-A',
    'a3000000-0000-4000-8000-000000000001',
    'S10',
    'a1000000-0000-4000-8000-000000000002',
    'CUSTOMER_CONFIDENTIAL',
    2,
    '2026-08-26T17:00:00Z',
    '2026-08-26T17:00:00Z',
    'human',
    'a1000000-0000-4000-8000-000000000002',
    '2026-08-26T17:00:00Z',
    'human',
    'a1000000-0000-4000-8000-000000000002'
  ),
  (
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'CAPA-AI-REVIEW-B',
    'b3000000-0000-4000-8000-000000000001',
    'S10',
    'b1000000-0000-4000-8000-000000000002',
    'CUSTOMER_CONFIDENTIAL',
    2,
    '2026-08-26T17:00:00Z',
    '2026-08-26T17:00:00Z',
    'human',
    'b1000000-0000-4000-8000-000000000002',
    '2026-08-26T17:00:00Z',
    'human',
    'b1000000-0000-4000-8000-000000000002'
  );

insert into public.capa_case_versions (
  case_version_id,
  organization_id,
  capa_case_id,
  version_number,
  change_reason,
  status,
  effective_at,
  created_at,
  created_by_actor_type,
  created_by_actor_id
)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    1,
    'Submitted intake review fixture',
    'S10',
    '2026-08-26T17:00:00Z',
    '2026-08-26T17:00:00Z',
    'human',
    'a1000000-0000-4000-8000-000000000002'
  ),
  (
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    1,
    'Submitted intake review fixture',
    'S10',
    '2026-08-26T17:00:00Z',
    '2026-08-26T17:00:00Z',
    'human',
    'b1000000-0000-4000-8000-000000000002'
  );

-- ---------------------------------------------------------------------------
-- Immutable governed AI-output fixtures
-- ---------------------------------------------------------------------------

insert into public.capa_ai_outputs (
  organization_id,
  output_id,
  run_id,
  capa_case_id,
  case_version_id,
  record_version,
  request_id,
  correlation_id,
  agent_id,
  agent_version,
  output_schema_version,
  status,
  proposal,
  advisory_only,
  workflow_mutated,
  human_acceptance_required,
  created_at
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'a4100000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    2,
    'a4200000-0000-4000-8000-000000000001',
    'a4300000-0000-4000-8000-000000000001',
    'AG-INTAKE',
    'ag-intake-1.0.0',
    'capa-intake-advisory-output-1.0.0',
    'completed_draft',
    '{
      "problem_statement_draft":"AI draft problem statement.",
      "scope_dimensions":["Product family"],
      "missing_dimensions":["Lot range"],
      "containment_risk_questions":["Has inventory been contained?"],
      "investigation_questions":["What evidence confirms the mechanism?"]
    }'::jsonb,
    true,
    false,
    true,
    '2026-08-26T17:05:00Z'
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000001',
    'b4100000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    2,
    'b4200000-0000-4000-8000-000000000001',
    'b4300000-0000-4000-8000-000000000001',
    'AG-INTAKE',
    'ag-intake-1.0.0',
    'capa-intake-advisory-output-1.0.0',
    'completed_draft',
    '{
      "problem_statement_draft":"Second-tenant AI draft.",
      "scope_dimensions":["Product family"],
      "missing_dimensions":[],
      "containment_risk_questions":[],
      "investigation_questions":["What evidence is available?"]
    }'::jsonb,
    true,
    false,
    true,
    '2026-08-26T17:05:00Z'
  ),
  (
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000009',
    'a4100000-0000-4000-8000-000000000009',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    2,
    'a4200000-0000-4000-8000-000000000009',
    'a4300000-0000-4000-8000-000000000009',
    'AG-INTAKE',
    'ag-intake-1.0.0',
    'capa-intake-advisory-output-1.0.0',
    'validation_failed',
    null,
    true,
    false,
    true,
    '2026-08-26T17:06:00Z'
  );

-- ---------------------------------------------------------------------------
-- Immutable audit-event fixtures
-- ---------------------------------------------------------------------------

insert into public.capa_audit_events (
  event_id,
  organization_id,
  event_type,
  schema_version,
  aggregate_type,
  aggregate_id,
  aggregate_version,
  actor_type,
  actor_id,
  occurred_at,
  request_id,
  correlation_id,
  idempotency_key,
  action,
  target_object_type,
  target_object_id,
  target_object_version_id,
  outcome,
  configuration_versions,
  metadata
)
values
  (
    'a5000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'EVT-AI-OUTPUT-REVIEWED',
    'audit-schema-test-1.0.0',
    'CAPA_CASE',
    'a2000000-0000-4000-8000-000000000001',
    2,
    'human',
    'a1000000-0000-4000-8000-000000000002',
    '2026-08-26T17:10:00Z',
    'a6000000-0000-4000-8000-000000000001',
    'a6100000-0000-4000-8000-000000000001',
    'shared-review-key',
    'REVIEW_AI_OUTPUT',
    'CAPA_AI_OUTPUT',
    'a4000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'succeeded',
    '{"review_policy":"capa-ai-output-review-1.0.0"}'::jsonb,
    '{"decision":"accept"}'::jsonb
  ),
  (
    'a5000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001',
    'EVT-AI-OUTPUT-REVIEWED',
    'audit-schema-test-1.0.0',
    'CAPA_CASE',
    'a2000000-0000-4000-8000-000000000001',
    2,
    'human',
    'a1000000-0000-4000-8000-000000000002',
    '2026-08-26T17:11:00Z',
    'a6000000-0000-4000-8000-000000000002',
    'a6100000-0000-4000-8000-000000000002',
    'reject-review-key',
    'REVIEW_AI_OUTPUT',
    'CAPA_AI_OUTPUT',
    'a4000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'succeeded',
    '{"review_policy":"capa-ai-output-review-1.0.0"}'::jsonb,
    '{"decision":"reject"}'::jsonb
  ),
  (
    'a5000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001',
    'EVT-AI-OUTPUT-REVIEWED',
    'audit-schema-test-1.0.0',
    'CAPA_CASE',
    'a2000000-0000-4000-8000-000000000001',
    2,
    'human',
    'a1000000-0000-4000-8000-000000000002',
    '2026-08-26T17:12:00Z',
    'a6000000-0000-4000-8000-000000000003',
    'a6100000-0000-4000-8000-000000000003',
    'revise-review-key',
    'REVIEW_AI_OUTPUT',
    'CAPA_AI_OUTPUT',
    'a4000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'succeeded',
    '{"review_policy":"capa-ai-output-review-1.0.0"}'::jsonb,
    '{"decision":"revise"}'::jsonb
  ),
  (
    'b5000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'EVT-AI-OUTPUT-REVIEWED',
    'audit-schema-test-1.0.0',
    'CAPA_CASE',
    'b2000000-0000-4000-8000-000000000001',
    2,
    'human',
    'b1000000-0000-4000-8000-000000000002',
    '2026-08-26T17:13:00Z',
    'b6000000-0000-4000-8000-000000000001',
    'b6100000-0000-4000-8000-000000000001',
    'shared-review-key',
    'REVIEW_AI_OUTPUT',
    'CAPA_AI_OUTPUT',
    'b4000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000001',
    'succeeded',
    '{"review_policy":"capa-ai-output-review-1.0.0"}'::jsonb,
    '{"decision":"accept"}'::jsonb
  );

-- ---------------------------------------------------------------------------
-- Valid dispositions
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    insert into public.capa_ai_output_reviews (
      organization_id,
      review_id,
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      decision,
      rationale,
      human_revision,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      review_policy_version,
      request_id,
      correlation_id,
      idempotency_key,
      request_fingerprint,
      audit_event_id,
      review_record,
      record_fingerprint_algorithm,
      record_fingerprint
    )
    values (
      'a1000000-0000-4000-8000-000000000001',
      'a7000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      2,
      'completed_draft',
      'accept',
      null,
      null,
      '2026-08-26T17:10:00Z',
      'human',
      'a1000000-0000-4000-8000-000000000002',
      'capa-ai-output-review-1.0.0',
      'a6000000-0000-4000-8000-000000000001',
      'a6100000-0000-4000-8000-000000000001',
      'shared-review-key',
      repeat('a', 64),
      'a5000000-0000-4000-8000-000000000001',
      '{"decision":"accept"}'::jsonb,
      'sha256',
      repeat('b', 64)
    )
  $$,
  'valid ACCEPT disposition is persisted'
);

select lives_ok(
  $$
    insert into public.capa_ai_output_reviews (
      organization_id, review_id, output_id, capa_case_id,
      case_version_id, record_version, output_status,
      decision, rationale, human_revision,
      reviewed_at, reviewed_by_actor_type, reviewed_by_actor_id,
      review_policy_version, request_id, correlation_id,
      idempotency_key, request_fingerprint, audit_event_id,
      review_record, record_fingerprint_algorithm, record_fingerprint
    )
    values (
      'a1000000-0000-4000-8000-000000000001',
      'a7000000-0000-4000-8000-000000000002',
      'a4000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      2,
      'completed_draft',
      'reject',
      'Human reviewer rejects the AI proposal.',
      null,
      '2026-08-26T17:11:00Z',
      'human',
      'a1000000-0000-4000-8000-000000000002',
      'capa-ai-output-review-1.0.0',
      'a6000000-0000-4000-8000-000000000002',
      'a6100000-0000-4000-8000-000000000002',
      'reject-review-key',
      repeat('c', 64),
      'a5000000-0000-4000-8000-000000000002',
      '{"decision":"reject"}'::jsonb,
      'sha256',
      repeat('d', 64)
    )
  $$,
  'valid REJECT disposition with rationale is persisted'
);

select lives_ok(
  $$
    insert into public.capa_ai_output_reviews (
      organization_id, review_id, output_id, capa_case_id,
      case_version_id, record_version, output_status,
      decision, rationale, human_revision,
      reviewed_at, reviewed_by_actor_type, reviewed_by_actor_id,
      review_policy_version, request_id, correlation_id,
      idempotency_key, request_fingerprint, audit_event_id,
      review_record, record_fingerprint_algorithm, record_fingerprint
    )
    values (
      'a1000000-0000-4000-8000-000000000001',
      'a7000000-0000-4000-8000-000000000003',
      'a4000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      2,
      'completed_draft',
      'revise',
      'Human reviewer made substantive corrections.',
      '{
        "problem_statement_draft":"Human-revised problem statement.",
        "scope_dimensions":["Product family"],
        "missing_dimensions":["Confirmed lot range"],
        "containment_risk_questions":["Has affected inventory been contained?"],
        "investigation_questions":["What evidence confirms the failure mechanism?"]
      }'::jsonb,
      '2026-08-26T17:12:00Z',
      'human',
      'a1000000-0000-4000-8000-000000000002',
      'capa-ai-output-review-1.0.0',
      'a6000000-0000-4000-8000-000000000003',
      'a6100000-0000-4000-8000-000000000003',
      'revise-review-key',
      repeat('e', 64),
      'a5000000-0000-4000-8000-000000000003',
      '{"decision":"revise"}'::jsonb,
      'sha256',
      repeat('f', 64)
    )
  $$,
  'valid REVISE disposition preserves a human-authored revision'
);

select is(
  (
    select count(*)::integer
    from public.capa_ai_output_reviews
    where organization_id =
      'a1000000-0000-4000-8000-000000000001'
  ),
  3,
  'three independent immutable review dispositions are retained'
);

-- ---------------------------------------------------------------------------
-- Fail-closed disposition constraints
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000010',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      'reject',
      null,
      null,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-reject-no-rationale',
      repeat('1', 64),
      gen_random_uuid(),
      '{"decision":"reject"}'::jsonb,
      'sha256',
      repeat('2', 64),
      false,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'REJECT without rationale is prohibited'
);

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000011',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      'revise',
      null,
      human_revision,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-revise-no-rationale',
      repeat('3', 64),
      gen_random_uuid(),
      '{"decision":"revise"}'::jsonb,
      'sha256',
      repeat('4', 64),
      false,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000003'
  $$,
  '23514',
  null,
  'REVISE without rationale is prohibited'
);

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000012',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      'revise',
      'Revision is required.',
      null,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-revise-no-content',
      repeat('5', 64),
      gen_random_uuid(),
      '{"decision":"revise"}'::jsonb,
      'sha256',
      repeat('6', 64),
      false,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'REVISE without a human revision is prohibited'
);

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000013',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      'accept',
      null,
      '{
        "problem_statement_draft":"Unauthorized accept revision.",
        "scope_dimensions":[],
        "missing_dimensions":[],
        "containment_risk_questions":[],
        "investigation_questions":[]
      }'::jsonb,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-accept-revision',
      repeat('7', 64),
      gen_random_uuid(),
      '{"decision":"accept"}'::jsonb,
      'sha256',
      repeat('8', 64),
      false,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'ACCEPT cannot contain a human revision'
);

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000014',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      decision,
      rationale,
      human_revision,
      reviewed_at,
      'agent',
      'AG-INTAKE',
      null,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-agent-review',
      repeat('9', 64),
      gen_random_uuid(),
      review_record,
      'sha256',
      repeat('a', 64),
      false,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'AI or agent actors cannot create human dispositions'
);

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000015',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      decision,
      rationale,
      human_revision,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-workflow-mutation',
      repeat('b', 64),
      gen_random_uuid(),
      review_record,
      'sha256',
      repeat('c', 64),
      true,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'review records cannot claim workflow mutation'
);

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000016',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      decision,
      rationale,
      human_revision,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-record-mutation',
      repeat('d', 64),
      gen_random_uuid(),
      review_record,
      'sha256',
      repeat('e', 64),
      false,
      true,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'review records cannot claim controlled-record mutation'
);

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000017',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      decision,
      rationale,
      human_revision,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-gate-approval',
      repeat('f', 64),
      gen_random_uuid(),
      review_record,
      'sha256',
      repeat('0', 64),
      false,
      false,
      true,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'review acceptance cannot claim CAPA gate approval'
);

-- ---------------------------------------------------------------------------
-- Exact output/version and status binding
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000018',
      output_id,
      capa_case_id,
      'a3000000-0000-4000-8000-000000000099',
      record_version,
      output_status,
      decision,
      rationale,
      human_revision,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-stale-snapshot',
      repeat('1', 64),
      gen_random_uuid(),
      review_record,
      'sha256',
      repeat('2', 64),
      false,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23503',
  null,
  'review cannot be bound to a nonexistent or mismatched AI snapshot'
);

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews (
      organization_id, review_id, output_id, capa_case_id,
      case_version_id, record_version, output_status,
      decision, rationale, human_revision,
      reviewed_at, reviewed_by_actor_type, reviewed_by_actor_id,
      review_policy_version, request_id, correlation_id,
      idempotency_key, request_fingerprint, audit_event_id,
      review_record, record_fingerprint_algorithm, record_fingerprint
    )
    values (
      'a1000000-0000-4000-8000-000000000001',
      'a7000000-0000-4000-8000-000000000019',
      'a4000000-0000-4000-8000-000000000009',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      2,
      'validation_failed',
      'accept',
      null,
      null,
      '2026-08-26T17:15:00Z',
      'human',
      'a1000000-0000-4000-8000-000000000002',
      'capa-ai-output-review-1.0.0',
      gen_random_uuid(),
      gen_random_uuid(),
      'invalid-failed-output',
      repeat('3', 64),
      gen_random_uuid(),
      '{"decision":"accept"}'::jsonb,
      'sha256',
      repeat('4', 64)
    )
  $$,
  '23514',
  null,
  'validation-failed AI output cannot receive a human disposition'
);

-- ---------------------------------------------------------------------------
-- Tenant-local idempotency
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000020',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      decision,
      rationale,
      human_revision,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      idempotency_key,
      repeat('5', 64),
      gen_random_uuid(),
      review_record,
      'sha256',
      repeat('6', 64),
      false,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23505',
  null,
  'one organization cannot claim the same review idempotency key twice'
);

select lives_ok(
  $$
    insert into public.capa_ai_output_reviews (
      organization_id, review_id, output_id, capa_case_id,
      case_version_id, record_version, output_status,
      decision, rationale, human_revision,
      reviewed_at, reviewed_by_actor_type, reviewed_by_actor_id,
      review_policy_version, request_id, correlation_id,
      idempotency_key, request_fingerprint, audit_event_id,
      review_record, record_fingerprint_algorithm, record_fingerprint
    )
    values (
      'b1000000-0000-4000-8000-000000000001',
      'b7000000-0000-4000-8000-000000000001',
      'b4000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      2,
      'completed_draft',
      'accept',
      null,
      null,
      '2026-08-26T17:13:00Z',
      'human',
      'b1000000-0000-4000-8000-000000000002',
      'capa-ai-output-review-1.0.0',
      'b6000000-0000-4000-8000-000000000001',
      'b6100000-0000-4000-8000-000000000001',
      'shared-review-key',
      repeat('7', 64),
      'b5000000-0000-4000-8000-000000000001',
      '{"decision":"accept"}'::jsonb,
      'sha256',
      repeat('8', 64)
    )
  $$,
  'different organizations may independently use the same opaque key'
);

-- ---------------------------------------------------------------------------
-- Audit linkage
-- ---------------------------------------------------------------------------

set constraints capa_ai_output_reviews_audit_event_fk immediate;

select throws_ok(
  $$
    insert into public.capa_ai_output_reviews
    select
      organization_id,
      'a7000000-0000-4000-8000-000000000021',
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status,
      decision,
      rationale,
      human_revision,
      reviewed_at,
      reviewed_by_actor_type,
      reviewed_by_actor_id,
      reviewed_by_actor_version,
      review_policy_version,
      gen_random_uuid(),
      gen_random_uuid(),
      'missing-audit-event',
      repeat('9', 64),
      'a5000000-0000-4000-8000-000000000099',
      review_record,
      'sha256',
      repeat('a', 64),
      false,
      false,
      false,
      statement_timestamp()
    from public.capa_ai_output_reviews
    where review_id =
      'a7000000-0000-4000-8000-000000000001'
  $$,
  '23503',
  null,
  'review cannot commit without its tenant-qualified audit event'
);

set constraints capa_ai_output_reviews_audit_event_fk deferred;

-- ---------------------------------------------------------------------------
-- Append-only behavior
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    update public.capa_ai_output_reviews
    set rationale = 'Unauthorized replacement'
    where organization_id =
      'a1000000-0000-4000-8000-000000000001'
      and review_id =
        'a7000000-0000-4000-8000-000000000002'
  $$,
  '55000',
  null,
  'persisted human review cannot be updated'
);

select throws_ok(
  $$
    delete from public.capa_ai_output_reviews
    where organization_id =
      'a1000000-0000-4000-8000-000000000001'
      and review_id =
        'a7000000-0000-4000-8000-000000000002'
  $$,
  '55000',
  null,
  'persisted human review cannot be deleted'
);

select throws_ok(
  $$
    update public.capa_ai_outputs
    set agent_version = 'unauthorized-replacement'
    where organization_id =
      'a1000000-0000-4000-8000-000000000001'
      and output_id =
        'a4000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  null,
  'reviewed governed AI output cannot be updated'
);

select throws_ok(
  $$
    delete from public.capa_ai_outputs
    where organization_id =
      'a1000000-0000-4000-8000-000000000001'
      and output_id =
        'a4000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  null,
  'reviewed governed AI output cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- Advisory-only invariants
-- ---------------------------------------------------------------------------

select is(
  (
    select proposal ->> 'problem_statement_draft'
    from public.capa_ai_outputs
    where organization_id =
      'a1000000-0000-4000-8000-000000000001'
      and output_id =
        'a4000000-0000-4000-8000-000000000001'
  ),
  'AI draft problem statement.',
  'REVISE preserves the original immutable AI proposal'
);

select is(
  (
    select record_version::integer
    from public.capa_cases
    where organization_id =
      'a1000000-0000-4000-8000-000000000001'
      and capa_case_id =
        'a2000000-0000-4000-8000-000000000001'
  ),
  2,
  'human AI-output review does not mutate the CAPA aggregate'
);

select is(
  (
    select count(*)::integer
    from public.capa_case_versions
    where organization_id =
      'a1000000-0000-4000-8000-000000000001'
      and capa_case_id =
        'a2000000-0000-4000-8000-000000000001'
  ),
  1,
  'human AI-output review does not create a CAPA case version'
);

select is(
  (
    select count(*)::integer
    from public.capa_ai_output_reviews
  ),
  4,
  'only the four valid immutable review records remain'
);

select * from finish();

rollback;
