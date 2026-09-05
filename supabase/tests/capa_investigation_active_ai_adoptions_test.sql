begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

select has_table('public', 'capa_investigation_active_ai_adoptions', 'S40 adoption table exists');
select has_pk('public', 'capa_investigation_active_ai_adoptions', 'S40 adoption identity is tenant-qualified');
select col_type_is('public', 'capa_investigation_active_ai_adoptions', 'organization_id', 'uuid', 'organization uses UUID');
select col_type_is('public', 'capa_investigation_active_ai_adoptions', 'adoption_id', 'uuid', 'adoption uses UUID');
select col_type_is('public', 'capa_investigation_active_ai_adoptions', 'adopted_item', 'jsonb', 'adopted item is structured JSON');
select col_type_is('public', 'capa_investigation_active_ai_adoptions', 'resolved_reference_bindings', 'jsonb', 'resolved bindings are structured JSON');
select col_type_is('public', 'capa_investigation_active_ai_adoptions', 'adoption_record', 'jsonb', 'canonical adoption record is stored');
select col_has_default('public', 'capa_investigation_active_ai_adoptions', 'created_at', 'created timestamp has a database default');
select has_trigger('public', 'capa_investigation_active_ai_adoptions', 'capa_s40_adoptions_reject_mutation', 'S40 adoption rows are immutable');
select ok((select relrowsecurity from pg_class where oid = 'public.capa_investigation_active_ai_adoptions'::regclass), 'RLS is enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.capa_investigation_active_ai_adoptions'::regclass), 'RLS is forced');
select ok(not has_table_privilege('anon', 'public.capa_investigation_active_ai_adoptions', 'SELECT'), 'anonymous clients cannot read');
select ok(not has_table_privilege('authenticated', 'public.capa_investigation_active_ai_adoptions', 'INSERT'), 'browser clients cannot insert');
select ok(has_table_privilege('service_role', 'public.capa_investigation_active_ai_adoptions', 'SELECT'), 'service role can read');
select ok(has_table_privilege('service_role', 'public.capa_investigation_active_ai_adoptions', 'INSERT'), 'service role can append');
select ok(not has_table_privilege('service_role', 'public.capa_investigation_active_ai_adoptions', 'UPDATE'), 'service role cannot update');
select ok(not has_table_privilege('service_role', 'public.capa_investigation_active_ai_adoptions', 'DELETE'), 'service role cannot delete');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.capa_investigation_active_ai_adoptions'::regclass and conname = 'capa_s40_adoptions_idempotency_unique' and contype = 'u'), 'idempotency and proposal are unique');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.capa_investigation_active_ai_adoptions'::regclass and conname = 'capa_s40_adoptions_audit_unique' and contype = 'u'), 'audit identity is unique');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.capa_investigation_active_ai_adoptions'::regclass and conname = 'capa_s40_adoptions_output_fk' and contype = 'f'), 'output snapshot is exactly foreign-key bound');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.capa_investigation_active_ai_adoptions'::regclass and conname = 'capa_s40_adoptions_manifest_fk' and contype = 'f'), 'reference manifest is foreign-key bound');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.capa_investigation_active_ai_adoptions'::regclass and conname = 'capa_s40_adoptions_audit_fk' and contype = 'f' and condeferrable and condeferred), 'audit relationship is deferred for same-transaction append');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.capa_investigation_active_ai_adoptions'::regclass and conname = 'capa_s40_adoptions_category' and contype = 'c'), 'category is restricted to CS5 categories');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.capa_investigation_active_ai_adoptions'::regclass and conname = 'capa_s40_adoptions_no_workflow' and contype = 'c'), 'workflow mutation is prohibited');

set constraints all deferred;

insert into public.capa_organizations (
  organization_id, organization_name, authorization_policy_version,
  effective_at, created_at, created_by_actor_type, created_by_actor_id,
  updated_at, updated_by_actor_type, updated_by_actor_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'S40 adoption test organization',
  'qualification-1.0.0', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z',
  'system', 'pg-tap', '2026-09-05T00:00:00Z', 'system', 'pg-tap'
);
insert into public.capa_organization_memberships (
  membership_id, organization_id, user_id, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'd1100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001', 'active',
  '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', 'system', 'pg-tap',
  '2026-09-05T00:00:00Z', 'system', 'pg-tap'
);
insert into public.capa_cases (
  capa_case_id, organization_id, case_number, current_version_id, status,
  owner_user_id, confidentiality, record_version, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'd1300000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001', 'CAPA-S40-ADOPTION',
  'd1400000-0000-4000-8000-000000000001', 'S40',
  'd1200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 4,
  '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', 'system', 'pg-tap',
  '2026-09-05T00:00:00Z', 'system', 'pg-tap'
);
insert into public.capa_case_versions (
  case_version_id, organization_id, capa_case_id, version_number,
  change_reason, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id
) values (
  'd1400000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001', 4, 'S40 adoption test', 'S40',
  '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', 'system', 'pg-tap'
);
insert into public.capa_ai_outputs (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, agent_id, agent_version,
  output_schema_version, status, proposal, advisory_only, workflow_mutated,
  human_acceptance_required
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001', 4,
  'd1700000-0000-4000-8000-000000000001',
  'd1800000-0000-4000-8000-000000000001', 'AG-RCA', 'ag-rca-1.0.0',
  'capa_investigation_analysis_draft-1.0.0', 'completed_draft', '{}'::jsonb,
  true, false, true
);
insert into public.capa_ai_outputs (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, agent_id, agent_version,
  output_schema_version, status, proposal, advisory_only, workflow_mutated,
  human_acceptance_required
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd1d00000-0000-4000-8000-000000000001',
  'd1e00000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001', 4,
  'd1f00000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001', 'AG-RCA', 'ag-rca-1.0.0',
  'capa_investigation_analysis_draft-1.0.0', 'completed_draft', '{}'::jsonb,
  true, false, true
);
insert into public.capa_ai_reference_manifests (
  organization_id, output_id, run_id, capa_case_id, case_version_id,
  record_version, request_id, correlation_id, output_status,
  manifest_schema_version, fingerprint_algorithm, reference_manifest,
  reference_manifest_sha256
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001', 4,
  'd1700000-0000-4000-8000-000000000001',
  'd1800000-0000-4000-8000-000000000001', 'completed_draft',
  'capa-investigation-active-reference-manifest-1.0.0',
  'sha256-canonical-json-v1',
  '{"manifest_schema_version":"capa-investigation-active-reference-manifest-1.0.0","workflow_state":"S40","entries":[]}'::jsonb,
  repeat('c', 64)
);

-- The adoption deliberately precedes its audit event; the FK is deferred.
insert into public.capa_investigation_active_ai_adoptions (
  organization_id, adoption_id, output_id, output_run_id, capa_case_id,
  case_version_id, record_version, output_status, output_request_id,
  output_correlation_id, proposal_key, proposal_category, adopted_item,
  resolved_reference_bindings, reference_manifest_schema_version,
  reference_manifest_fingerprint_algorithm, reference_manifest_sha256,
  adopted_at, adopted_by_actor_type, adopted_by_actor_id,
  adoption_policy_version, request_id, correlation_id, idempotency_key,
  request_fingerprint, audit_event_id, adoption_record,
  record_fingerprint_algorithm, record_fingerprint, workflow_mutated,
  controlled_record_mutated, gate_approved
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd1900000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001', 4, 'completed_draft',
  'd1700000-0000-4000-8000-000000000001',
  'd1800000-0000-4000-8000-000000000001', 'P1', 'evidence_gap',
  '{"proposal_key":"P1","adopted_content":{"gap":"Gap","why_it_matters":"Why","recommended_next_step":"Next"}}'::jsonb,
  '[]'::jsonb, 'capa-investigation-active-reference-manifest-1.0.0',
  'sha256-canonical-json-v1', repeat('c', 64), '2026-09-05T12:00:00Z',
  'human', 'd1200000-0000-4000-8000-000000000001',
  'capa-investigation-active-adoption-1.0.0',
  'd1a00000-0000-4000-8000-000000000001',
  'd1b00000-0000-4000-8000-000000000001', 'batch-1', repeat('a', 64),
  'd1c00000-0000-4000-8000-000000000001',
  '{"adoption_id":"d1900000-0000-4000-8000-000000000001","organization_id":"d1000000-0000-4000-8000-000000000001","capa_case_id":"d1300000-0000-4000-8000-000000000001","case_version_id":"d1400000-0000-4000-8000-000000000001","record_version":4,"output_id":"d1500000-0000-4000-8000-000000000001","proposal_key":"P1","workflow_mutated":false,"controlled_record_mutated":false,"gate_approved":false}'::jsonb,
  'sha256', repeat('b', 64), false, false, false
);
insert into public.capa_audit_events (
  event_id, organization_id, event_type, schema_version, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_id, occurred_at,
  request_id, correlation_id, action, target_object_type, target_object_id,
  outcome, configuration_versions
) values (
  'd1c00000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001', 'EVT-AI-PROPOSAL-ADOPTED',
  'audit-1.0.0', 'CAPA_CASE', 'd1300000-0000-4000-8000-000000000001', 4,
  'human', 'd1200000-0000-4000-8000-000000000001',
  '2026-09-05T12:00:00Z', 'd1a00000-0000-4000-8000-000000000001',
  'd1b00000-0000-4000-8000-000000000001',
  'ADOPT_CAPA_INVESTIGATION_ACTIVE_AI_PROPOSALS',
  'CAPA_INVESTIGATION_ACTIVE_ADOPTION',
  'd1900000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb
);

select ok(exists (select 1 from public.capa_investigation_active_ai_adoptions where adoption_id = 'd1900000-0000-4000-8000-000000000001'), 'valid S40 adoption append succeeds');
select throws_ok($$update public.capa_investigation_active_ai_adoptions set proposal_key = 'P2' where adoption_id = 'd1900000-0000-4000-8000-000000000001'$$, '55000', 'capa_investigation_active_ai_adoptions is append-only and cannot be updated or deleted', 'UPDATE is rejected');
select throws_ok($$delete from public.capa_investigation_active_ai_adoptions where adoption_id = 'd1900000-0000-4000-8000-000000000001'$$, '55000', 'capa_investigation_active_ai_adoptions is append-only and cannot be updated or deleted', 'DELETE is rejected');

create or replace function pg_temp.try_s40_adoption(
  p_adoption_id uuid default gen_random_uuid(), p_output_id uuid default 'd1500000-0000-4000-8000-000000000001',
  p_output_run uuid default 'd1600000-0000-4000-8000-000000000001',
  p_output_request uuid default 'd1700000-0000-4000-8000-000000000001',
  p_output_correlation uuid default 'd1800000-0000-4000-8000-000000000001',
  p_category text default 'evidence_gap', p_proposal_key text default 'P1',
  p_manifest_sha text default repeat('c', 64), p_request_sha text default repeat('a', 64),
  p_record_sha text default repeat('b', 64), p_record_algorithm text default 'sha256',
  p_actor_type text default 'human', p_policy text default 'capa-investigation-active-adoption-1.0.0',
  p_idempotency text default 'batch-test', p_workflow boolean default false,
  p_controlled boolean default false, p_gate boolean default false,
  p_audit_id uuid default gen_random_uuid()
) returns boolean language plpgsql as $function$
begin
  insert into public.capa_investigation_active_ai_adoptions (
    organization_id, adoption_id, output_id, output_run_id, capa_case_id,
    case_version_id, record_version, output_status, output_request_id,
    output_correlation_id, proposal_key, proposal_category, adopted_item,
    resolved_reference_bindings, reference_manifest_schema_version,
    reference_manifest_fingerprint_algorithm, reference_manifest_sha256,
    adopted_at, adopted_by_actor_type, adopted_by_actor_id,
    adoption_policy_version, request_id, correlation_id, idempotency_key,
    request_fingerprint, audit_event_id, adoption_record,
    record_fingerprint_algorithm, record_fingerprint, workflow_mutated,
    controlled_record_mutated, gate_approved
  ) values (
    'd1000000-0000-4000-8000-000000000001', p_adoption_id, p_output_id,
    p_output_run,
    'd1300000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001', 4, 'completed_draft',
    p_output_request, p_output_correlation, p_proposal_key, p_category,
    jsonb_build_object('proposal_key', p_proposal_key, 'adopted_content', jsonb_build_object('gap', 'Gap', 'why_it_matters', 'Why', 'recommended_next_step', 'Next')),
    '[]'::jsonb, 'capa-investigation-active-reference-manifest-1.0.0',
    'sha256-canonical-json-v1', p_manifest_sha, '2026-09-05T12:00:00Z',
    p_actor_type, 'd1200000-0000-4000-8000-000000000001', p_policy,
    'd1a00000-0000-4000-8000-000000000001',
    'd1b00000-0000-4000-8000-000000000001', p_idempotency,
    p_request_sha, p_audit_id,
    jsonb_build_object('adoption_id', p_adoption_id::text, 'organization_id', 'd1000000-0000-4000-8000-000000000001', 'capa_case_id', 'd1300000-0000-4000-8000-000000000001', 'case_version_id', 'd1400000-0000-4000-8000-000000000001', 'record_version', 4, 'output_id', p_output_id::text, 'proposal_key', p_proposal_key, 'workflow_mutated', p_workflow, 'controlled_record_mutated', p_controlled, 'gate_approved', p_gate),
    p_record_algorithm, p_record_sha, p_workflow, p_controlled, p_gate
  );
  return true;
exception when others then
  return false;
end;
$function$;

select ok(not pg_temp.try_s40_adoption(p_workflow := true), 'workflow_mutated=true is rejected');
select ok(not pg_temp.try_s40_adoption(p_controlled := true), 'controlled_record_mutated=true is rejected');
select ok(not pg_temp.try_s40_adoption(p_gate := true), 'gate_approved=true is rejected');
select ok(not pg_temp.try_s40_adoption(p_category := 'invalid_category'), 'invalid proposal category is rejected');
select ok(not pg_temp.try_s40_adoption(p_proposal_key := 'bad'), 'malformed proposal key is rejected');
select ok(not pg_temp.try_s40_adoption(p_manifest_sha := repeat('x', 64)), 'malformed manifest SHA is rejected');
select ok(not pg_temp.try_s40_adoption(p_request_sha := 'bad'), 'malformed request fingerprint is rejected');
select ok(not pg_temp.try_s40_adoption(p_record_sha := 'bad'), 'malformed record fingerprint is rejected');
select ok(not pg_temp.try_s40_adoption(p_record_algorithm := 'md5'), 'wrong record fingerprint algorithm is rejected');
select ok(not pg_temp.try_s40_adoption(p_actor_type := 'service'), 'non-human adopter is rejected');
select ok(not pg_temp.try_s40_adoption(p_policy := 'wrong-policy'), 'wrong adoption policy is rejected');
select ok(not pg_temp.try_s40_adoption(p_idempotency := ''), 'invalid idempotency key is rejected');
select ok(not pg_temp.try_s40_adoption(p_output_id := 'd1c00000-0000-4000-8000-000000000001'), 'missing output composite FK is rejected');
select ok(not pg_temp.try_s40_adoption(p_output_id := 'd1d00000-0000-4000-8000-000000000001', p_output_run := 'd1e00000-0000-4000-8000-000000000001', p_output_request := 'd1f00000-0000-4000-8000-000000000001', p_output_correlation := 'd2000000-0000-4000-8000-000000000001'), 'missing manifest composite FK is rejected');
select ok(not pg_temp.try_s40_adoption(p_adoption_id := 'd1900000-0000-4000-8000-000000000001'), 'duplicate adoption identity is rejected');
select ok(not pg_temp.try_s40_adoption(p_idempotency := 'batch-1'), 'duplicate idempotency/proposal identity is rejected');
select ok(not pg_temp.try_s40_adoption(p_audit_id := 'd1c00000-0000-4000-8000-000000000001'), 'duplicate audit identity is rejected');

create or replace function pg_temp.try_s40_missing_audit() returns boolean
language plpgsql as $function$
begin
  perform pg_temp.try_s40_adoption(
    p_idempotency := 'batch-missing-audit',
    p_audit_id := 'd2100000-0000-4000-8000-000000000001'
  );
  set constraints capa_s40_adoptions_audit_fk immediate;
  return false;
exception when others then
  return true;
end;
$function$;

select ok(pg_temp.try_s40_missing_audit(), 'deferred audit FK fails when the audit event never appears');
set constraints all deferred;

select * from finish();
rollback;
