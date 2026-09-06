begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

set constraints all deferred;

select has_table(
  'public',
  'capa_ai_reference_manifests',
  'S40 reference-manifest table exists'
);

select has_pk(
  'public',
  'capa_ai_reference_manifests',
  'reference manifests have a tenant-qualified primary key'
);

select col_type_is(
  'public',
  'capa_ai_reference_manifests',
  'record_version',
  'bigint',
  'reference-manifest record version uses bigint'
);

select col_has_default(
  'public',
  'capa_ai_reference_manifests',
  'created_at',
  'reference-manifest persistence has a database timestamp default'
);

select has_trigger(
  'public',
  'capa_ai_reference_manifests',
  'capa_ai_reference_manifests_reject_mutation',
  'reference manifests have the immutable-record trigger'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.capa_ai_reference_manifests'::regclass),
  'reference-manifest row-level security is enabled'
);

select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.capa_ai_reference_manifests'::regclass),
  'reference-manifest row-level security is forced'
);

select ok(not has_table_privilege('anon', 'public.capa_ai_reference_manifests', 'SELECT'),
  'anonymous clients cannot read reference manifests');
select ok(not has_table_privilege('authenticated', 'public.capa_ai_reference_manifests', 'SELECT'),
  'authenticated clients cannot read reference manifests');
select ok(not has_table_privilege('authenticated', 'public.capa_ai_reference_manifests', 'INSERT'),
  'authenticated clients cannot create reference manifests');
select ok(has_table_privilege('service_role', 'public.capa_ai_reference_manifests', 'SELECT'),
  'service role can read reference manifests');
select ok(has_table_privilege('service_role', 'public.capa_ai_reference_manifests', 'INSERT'),
  'service role can append reference manifests');
select ok(not has_table_privilege('service_role', 'public.capa_ai_reference_manifests', 'UPDATE'),
  'service role cannot update reference manifests');
select ok(not has_table_privilege('service_role', 'public.capa_ai_reference_manifests', 'DELETE'),
  'service role cannot delete reference manifests');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_ai_reference_manifests'::regclass
    and conname = 'capa_ai_reference_manifests_run_unique'
    and contype = 'u'
), 'one manifest run identity is allowed per organization');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_ai_reference_manifests'::regclass
    and conname = 'capa_ai_reference_manifests_record_version_positive'
    and contype = 'c'
), 'manifest record version must be positive');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_ai_reference_manifests'::regclass
    and conname = 'capa_ai_reference_manifests_schema_version'
    and contype = 'c'
), 'manifest schema version is controlled');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_ai_reference_manifests'::regclass
    and conname = 'capa_ai_reference_manifests_fingerprint_algorithm'
    and contype = 'c'
), 'manifest fingerprint algorithm is controlled');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_ai_reference_manifests'::regclass
    and conname = 'capa_ai_reference_manifests_document_object'
    and contype = 'c'
), 'reference manifest must be a JSON object');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_ai_reference_manifests'::regclass
    and conname = 'capa_ai_reference_manifests_sha256'
    and contype = 'c'
), 'reference-manifest fingerprint is constrained to lowercase SHA-256');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_ai_reference_manifests'::regclass
    and conname = 'capa_ai_reference_manifests_output_fk'
    and contype = 'f'
), 'manifest is foreign-key bound to the exact AI output identity');

select is(
  (
    select string_agg(
      child_attribute.attname || '->' || parent_attribute.attname,
      ',' order by position.i
    )
    from pg_catalog.pg_constraint as constraint_record
    cross join lateral generate_subscripts(constraint_record.conkey, 1) as position(i)
    join pg_catalog.pg_attribute as child_attribute
      on child_attribute.attrelid = constraint_record.conrelid
      and child_attribute.attnum = constraint_record.conkey[position.i]
    join pg_catalog.pg_attribute as parent_attribute
      on parent_attribute.attrelid = constraint_record.confrelid
      and parent_attribute.attnum = constraint_record.confkey[position.i]
    where constraint_record.conrelid = 'public.capa_ai_reference_manifests'::regclass
      and constraint_record.conname = 'capa_ai_reference_manifests_output_fk'
  ),
  'organization_id->organization_id,output_id->output_id,run_id->run_id,capa_case_id->capa_case_id,case_version_id->case_version_id,record_version->record_version,request_id->request_id,correlation_id->correlation_id,output_status->status',
  'manifest FK binds output, run, case, version, request, correlation, and status'
);

select ok(exists (
  select 1
  from pg_catalog.pg_trigger as trigger_record
  where trigger_record.tgrelid = 'public.capa_ai_outputs'::regclass
    and trigger_record.tgname = 'capa_ai_outputs_require_s40_reference_manifest'
    and trigger_record.tgconstraint <> 0
    and trigger_record.tgdeferrable
    and trigger_record.tginitdeferred
), 'S40 reference-manifest requirement is deferred');

select ok(exists (
  select 1
  from pg_catalog.pg_proc as function_record
  join pg_catalog.pg_namespace as namespace_record
    on namespace_record.oid = function_record.pronamespace
  where namespace_record.nspname = 'private'
    and function_record.proname = 'capa_require_s40_reference_manifest'
    and function_record.prosrc like '%new.agent_id = ''AG-RCA''%'
    and function_record.prosrc like '%new.agent_version = ''ag-rca-1.0.0''%'
    and function_record.prosrc like '%new.output_schema_version = ''capa_investigation_analysis_draft-1.0.0''%'
    and function_record.prosrc like '%new.status = ''completed_draft''%'
), 'manifest requirement is limited to completed S40 AG-RCA output');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'public.capa_ai_reference_manifests'::regclass
    and conname = 'capa_ai_reference_manifests_schema_version'
    and pg_get_constraintdef(oid) like '%capa-root-cause-review-reference-manifest-1.0.0%'
), 'reference-manifest schema permits the governed S50 manifest version');

select ok(exists (
  select 1
  from pg_catalog.pg_proc as function_record
  join pg_catalog.pg_namespace as namespace_record
    on namespace_record.oid = function_record.pronamespace
  where namespace_record.nspname = 'private'
    and function_record.proname = 'capa_require_s40_reference_manifest'
    and function_record.prosrc like '%new.agent_id = ''AG-REVIEW''%'
    and function_record.prosrc like '%new.agent_version = ''ag-review-1.0.0''%'
    and function_record.prosrc like '%new.output_schema_version = ''capa_review_packet_draft-1.0.0''%'
    and function_record.prosrc like '%capa-root-cause-review-reference-manifest-1.0.0%'
), 'manifest requirement includes completed S50 AG-REVIEW output');

-- Controlled database fixtures. The S40 output is inserted first, followed by
-- its trace and server-only manifest, proving the deferred triple-write order.
insert into public.capa_organizations (
  organization_id, organization_name, authorization_policy_version,
  effective_at, created_at, created_by_actor_type, created_by_actor_id,
  updated_at, updated_by_actor_type, updated_by_actor_id
) values (
  'c1000000-0000-4000-8000-000000000001', 'S40 manifest test organization',
  'qualification-1.0.0', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z',
  'system', 'sql-test', '2026-09-05T00:00:00Z', 'system', 'sql-test'
);

insert into public.capa_organization_memberships (
  membership_id, organization_id, user_id, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'c1100000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001', 'active',
  '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', 'system', 'sql-test',
  '2026-09-05T00:00:00Z', 'system', 'sql-test'
);

insert into public.capa_cases (
  capa_case_id, organization_id, case_number, current_version_id, status,
  owner_user_id, confidentiality, record_version, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'c1300000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001', 'CAPA-S40-MANIFEST',
  'c1400000-0000-4000-8000-000000000001', 'S40',
  'c1200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 4,
  '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', 'human', 'sql-test',
  '2026-09-05T00:00:00Z', 'human', 'sql-test'
);

insert into public.capa_case_versions (
  case_version_id, organization_id, capa_case_id, version_number,
  change_reason, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id
) values (
  'c1400000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001', 4,
  'S40 manifest qualification', 'S40', '2026-09-05T00:00:00Z',
  '2026-09-05T00:00:00Z', 'human', 'sql-test'
);

insert into public.capa_ai_outputs (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, agent_id, agent_version,
  output_schema_version, status, proposal, advisory_only, workflow_mutated,
  human_acceptance_required
) values (
  'c1000000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1600000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001', 4,
  'c1700000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001', 'AG-RCA', 'ag-rca-1.0.0',
  'capa_investigation_analysis_draft-1.0.0', 'completed_draft', '{}'::jsonb,
  true, false, true
);

insert into public.capa_ai_generation_traces (
  organization_id, run_id, output_id, capa_case_id, case_version_id,
  record_version, output_status, request_id, correlation_id, prompt_package_id,
  trace_schema_version, fingerprint_algorithm, prompt_package,
  prompt_package_sha256, rendered_prompt_sha256, evidence_manifest,
  evidence_manifest_sha256, policy_manifest, policy_manifest_sha256,
  model_profile_version, assembled_at
) values (
  'c1000000-0000-4000-8000-000000000001',
  'c1600000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001', 4, 'completed_draft',
  'c1700000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'c1900000-0000-4000-8000-000000000001',
  'capa-ai-generation-trace-1.0.0', 'sha256-canonical-json-v1', '{}'::jsonb,
  repeat('a', 64), repeat('b', 64), '{}'::jsonb, repeat('c', 64),
  '{}'::jsonb, repeat('d', 64), 'qualification-profile-1.0.0',
  '2026-09-05T00:00:00Z'
);

insert into public.capa_ai_reference_manifests (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, output_status,
  manifest_schema_version, fingerprint_algorithm, reference_manifest,
  reference_manifest_sha256
) values (
  'c1000000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1600000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001', 4,
  'c1700000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001', 'completed_draft',
  'capa-investigation-active-reference-manifest-1.0.0',
  'sha256-canonical-json-v1',
  '{"entries":[],"manifest_schema_version":"capa-investigation-active-reference-manifest-1.0.0","workflow_state":"S40"}'::jsonb,
  repeat('e', 64)
);

set constraints all immediate;
select is((select count(*)::integer from public.capa_ai_outputs where output_id = 'c1500000-0000-4000-8000-000000000001'), 1,
  'qualified S40 output persists');
select is((select count(*)::integer from public.capa_ai_generation_traces where output_id = 'c1500000-0000-4000-8000-000000000001'), 1,
  'qualified generation trace persists');
select is((select count(*)::integer from public.capa_ai_reference_manifests where output_id = 'c1500000-0000-4000-8000-000000000001'), 1,
  'server-only reference manifest persists separately');

select throws_ok($$ update public.capa_ai_reference_manifests
  set reference_manifest_sha256 = repeat('f', 64)
  where output_id = 'c1500000-0000-4000-8000-000000000001' $$,
  '55000', null, 'reference manifest UPDATE is rejected');

select throws_ok($$ delete from public.capa_ai_reference_manifests
  where output_id = 'c1500000-0000-4000-8000-000000000001' $$,
  '55000', null, 'reference manifest DELETE is rejected');

-- A missing manifest fails when the deferred requirement is made immediate.
select throws_ok($$
  do $missing_manifest$
  begin
    insert into public.capa_ai_outputs (
      organization_id, output_id, run_id, capa_case_id, case_version_id,
      record_version, request_id, correlation_id, agent_id, agent_version,
      output_schema_version, status, proposal, advisory_only, workflow_mutated,
      human_acceptance_required
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      'c1500000-0000-4000-8000-000000000002',
      'c1600000-0000-4000-8000-000000000002',
      'c1300000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001', 4,
      'c1700000-0000-4000-8000-000000000002',
      'c1800000-0000-4000-8000-000000000002', 'AG-RCA', 'ag-rca-1.0.0',
      'capa_investigation_analysis_draft-1.0.0', 'completed_draft', '{}'::jsonb,
      true, false, true
    );
    insert into public.capa_ai_generation_traces (
      organization_id, run_id, output_id, capa_case_id, case_version_id,
      record_version, output_status, request_id, correlation_id, prompt_package_id,
      trace_schema_version, fingerprint_algorithm, prompt_package,
      prompt_package_sha256, rendered_prompt_sha256, evidence_manifest,
      evidence_manifest_sha256, policy_manifest, policy_manifest_sha256,
      model_profile_version, assembled_at
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      'c1600000-0000-4000-8000-000000000002',
      'c1500000-0000-4000-8000-000000000002',
      'c1300000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001', 4, 'completed_draft',
      'c1700000-0000-4000-8000-000000000002',
      'c1800000-0000-4000-8000-000000000002',
      'c1900000-0000-4000-8000-000000000002',
      'capa-ai-generation-trace-1.0.0', 'sha256-canonical-json-v1', '{}',
      repeat('a', 64), repeat('b', 64), '{}', repeat('c', 64), '{}',
      repeat('d', 64), 'qualification-profile-1.0.0', '2026-09-05T00:00:00Z'
    );
    set constraints capa_ai_outputs_require_s40_reference_manifest immediate;
  end
  $missing_manifest$
$$, '23514', null, 'completed S40 AG-RCA output cannot commit without a manifest');

-- ---------------------------------------------------------------------------
-- Controlled S50 AG-REVIEW triple-write qualification
-- ---------------------------------------------------------------------------

insert into public.capa_cases (
  capa_case_id, organization_id, case_number, current_version_id, status,
  owner_user_id, confidentiality, record_version, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'c2300000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001', 'CAPA-S50-MANIFEST',
  'c2400000-0000-4000-8000-000000000001', 'S50',
  'c1200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 4,
  '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', 'human', 'sql-test',
  '2026-09-05T00:00:00Z', 'human', 'sql-test'
);

insert into public.capa_case_versions (
  case_version_id, organization_id, capa_case_id, version_number,
  change_reason, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id
) values (
  'c2400000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c2300000-0000-4000-8000-000000000001', 4,
  'S50 manifest qualification', 'S50', '2026-09-05T00:00:00Z',
  '2026-09-05T00:00:00Z', 'human', 'sql-test'
);

insert into public.capa_ai_outputs (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, agent_id, agent_version,
  output_schema_version, status, proposal, output_payload, advisory_only,
  workflow_mutated, human_acceptance_required
) values (
  'c1000000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000001',
  'c2600000-0000-4000-8000-000000000001',
  'c2300000-0000-4000-8000-000000000001',
  'c2400000-0000-4000-8000-000000000001', 4,
  'c2700000-0000-4000-8000-000000000001',
  'c2800000-0000-4000-8000-000000000001', 'AG-REVIEW', 'ag-review-1.0.0',
  'capa_review_packet_draft-1.0.0', 'completed_draft', '{}'::jsonb,
  '{}'::jsonb, true, false, true
);

insert into public.capa_ai_generation_traces (
  organization_id, run_id, output_id, capa_case_id, case_version_id,
  record_version, output_status, request_id, correlation_id, prompt_package_id,
  trace_schema_version, fingerprint_algorithm, prompt_package,
  prompt_package_sha256, rendered_prompt_sha256, evidence_manifest,
  evidence_manifest_sha256, policy_manifest, policy_manifest_sha256,
  model_profile_version, assembled_at
) values (
  'c1000000-0000-4000-8000-000000000001',
  'c2600000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000001',
  'c2300000-0000-4000-8000-000000000001',
  'c2400000-0000-4000-8000-000000000001', 4, 'completed_draft',
  'c2700000-0000-4000-8000-000000000001',
  'c2800000-0000-4000-8000-000000000001',
  'c2900000-0000-4000-8000-000000000001',
  'capa-ai-generation-trace-1.0.0', 'sha256-canonical-json-v1', '{}'::jsonb,
  repeat('a', 64), repeat('b', 64), '{}'::jsonb, repeat('c', 64),
  '{}'::jsonb, repeat('d', 64), 's50-review-profile-1.0.0',
  '2026-09-05T00:00:00Z'
);

insert into public.capa_ai_reference_manifests (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, output_status,
  manifest_schema_version, fingerprint_algorithm, reference_manifest,
  reference_manifest_sha256
) values (
  'c1000000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000001',
  'c2600000-0000-4000-8000-000000000001',
  'c2300000-0000-4000-8000-000000000001',
  'c2400000-0000-4000-8000-000000000001', 4,
  'c2700000-0000-4000-8000-000000000001',
  'c2800000-0000-4000-8000-000000000001', 'completed_draft',
  'capa-root-cause-review-reference-manifest-1.0.0',
  'sha256-canonical-json-v1',
  '{"entries":[],"manifest_schema_version":"capa-root-cause-review-reference-manifest-1.0.0"}'::jsonb,
  repeat('e', 64)
);

set constraints all immediate;
select is((select count(*)::integer from public.capa_ai_outputs where output_id = 'c2500000-0000-4000-8000-000000000001'), 1, 'qualified S50 output persists');
select is((select count(*)::integer from public.capa_ai_generation_traces where output_id = 'c2500000-0000-4000-8000-000000000001'), 1, 'qualified S50 generation trace persists');
select is((select count(*)::integer from public.capa_ai_reference_manifests where output_id = 'c2500000-0000-4000-8000-000000000001'), 1, 'qualified S50 reference manifest persists');

select throws_ok($$ insert into public.capa_ai_reference_manifests (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, output_status,
  manifest_schema_version, fingerprint_algorithm, reference_manifest,
  reference_manifest_sha256
) values (
  'c1000000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000001',
  'c2600000-0000-4000-8000-000000000001',
  'c2300000-0000-4000-8000-000000000001',
  'c2400000-0000-4000-8000-000000000001', 4,
  'c2700000-0000-4000-8000-000000000001',
  'c2800000-0000-4000-8000-000000000001', 'completed_draft',
  'wrong-s50-schema', 'sha256-canonical-json-v1', '{}'::jsonb, repeat('f', 64)
) $$, '23514', null, 'wrong S50 reference-manifest schema is rejected');

select throws_ok($$
  do $missing_s50_manifest$
  begin
    insert into public.capa_ai_outputs (
      organization_id, output_id, run_id, capa_case_id, case_version_id,
      record_version, request_id, correlation_id, agent_id, agent_version,
      output_schema_version, status, proposal, output_payload, advisory_only,
      workflow_mutated, human_acceptance_required
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      'c2500000-0000-4000-8000-000000000002',
      'c2600000-0000-4000-8000-000000000002',
      'c2300000-0000-4000-8000-000000000001',
      'c2400000-0000-4000-8000-000000000001', 4,
      'c2700000-0000-4000-8000-000000000002',
      'c2800000-0000-4000-8000-000000000002', 'AG-REVIEW', 'ag-review-1.0.0',
      'capa_review_packet_draft-1.0.0', 'completed_draft', '{}'::jsonb,
      '{}'::jsonb, true, false, true
    );
    insert into public.capa_ai_generation_traces (
      organization_id, run_id, output_id, capa_case_id, case_version_id,
      record_version, output_status, request_id, correlation_id, prompt_package_id,
      trace_schema_version, fingerprint_algorithm, prompt_package,
      prompt_package_sha256, rendered_prompt_sha256, evidence_manifest,
      evidence_manifest_sha256, policy_manifest, policy_manifest_sha256,
      model_profile_version, assembled_at
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      'c2600000-0000-4000-8000-000000000002',
      'c2500000-0000-4000-8000-000000000002',
      'c2300000-0000-4000-8000-000000000001',
      'c2400000-0000-4000-8000-000000000001', 4, 'completed_draft',
      'c2700000-0000-4000-8000-000000000002',
      'c2800000-0000-4000-8000-000000000002',
      'c2900000-0000-4000-8000-000000000002',
      'capa-ai-generation-trace-1.0.0', 'sha256-canonical-json-v1', '{}'::jsonb,
      repeat('a', 64), repeat('b', 64), '{}'::jsonb, repeat('c', 64), '{}',
      repeat('d', 64), 's50-review-profile-1.0.0', '2026-09-05T00:00:00Z'
    );
    set constraints capa_ai_outputs_require_s40_reference_manifest immediate;
  end
  $missing_s50_manifest$
$$, '23514', null, 'completed S50 AG-REVIEW output cannot commit without a manifest');

select throws_ok($$ insert into public.capa_ai_reference_manifests (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, output_status,
  manifest_schema_version, fingerprint_algorithm, reference_manifest,
  reference_manifest_sha256
) values (
  'c1000000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000003',
  'c2600000-0000-4000-8000-000000000001',
  'c2300000-0000-4000-8000-000000000001',
  'c2400000-0000-4000-8000-000000000001', 4,
  'c2700000-0000-4000-8000-000000000001',
  'c2800000-0000-4000-8000-000000000001', 'completed_draft',
  'capa-root-cause-review-reference-manifest-1.0.0',
  'sha256-canonical-json-v1', '{}'::jsonb, repeat('f', 64)
) $$, '23503', null, 'mismatched S50 manifest tuple cannot satisfy the output binding');

select throws_ok($$ update public.capa_ai_reference_manifests
  set reference_manifest_sha256 = repeat('f', 64)
  where output_id = 'c2500000-0000-4000-8000-000000000001' $$,
  '55000', null, 'qualified S50 reference manifest remains immutable');

select * from finish();
rollback;
