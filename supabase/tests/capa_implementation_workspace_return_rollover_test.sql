begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

set constraints all deferred;

select has_trigger(
  'public',
  'capa_implementation_workspace_drafts',
  'capa_s80_implementation_workspace_baseline_guard',
  'S80 workspace baseline guard trigger exists'
);

select ok(
  position(
    'old.case_version_id <> new.case_version_id'
    in pg_get_functiondef(
      'private.capa_s80_implementation_workspace_baseline_guard()'::regprocedure
    )
  ) > 0,
  'workspace guard contains an explicit rollover branch'
);

insert into public.capa_organizations (
  organization_id, organization_name, authorization_policy_version,
  effective_at, created_at, created_by_actor_type, created_by_actor_id,
  updated_at, updated_by_actor_type, updated_by_actor_id
) values (
  'f1000000-0000-4000-8000-000000000001', 'S80 rollover qualification',
  'qualification-1.0.0', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z',
  'system', 'pg-tap', '2026-09-12T00:00:00Z', 'system', 'pg-tap'
);

insert into public.capa_organization_memberships (
  membership_id, organization_id, user_id, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'f1100000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000001', 'active',
  '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap',
  '2026-09-12T00:00:00Z', 'system', 'pg-tap'
);

insert into public.capa_cases (
  capa_case_id, organization_id, case_number, current_version_id, status,
  owner_user_id, confidentiality, record_version, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'f1300000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001', 'CAPA-S80-ROLLOVER',
  'f1410000-0000-4000-8000-000000000001', 'S80',
  'f1200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 8,
  '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap',
  '2026-09-12T00:00:00Z', 'system', 'pg-tap'
);

insert into public.capa_case_versions (
  case_version_id, organization_id, capa_case_id, version_number,
  parent_version_id, change_reason, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id
) values
  ('f1400000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 7, null, 'S70 baseline', 'S70', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1410000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 8, 'f1400000-0000-4000-8000-000000000001', 'S80 first entry', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1420000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 9, 'f1410000-0000-4000-8000-000000000001', 'S90 first return review', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1430000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 10, 'f1420000-0000-4000-8000-000000000001', 'S80 first return result', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1440000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 11, 'f1430000-0000-4000-8000-000000000001', 'S90 second return review', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1450000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 12, 'f1440000-0000-4000-8000-000000000001', 'S80 second return result', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1460000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 13, 'f1450000-0000-4000-8000-000000000001', 'unrelated S80 target', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1470000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 14, 'f1410000-0000-4000-8000-000000000001', 'wrong S90 parent', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1480000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 15, 'f1470000-0000-4000-8000-000000000001', 'wrong S90 result', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1490000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 16, 'f1450000-0000-4000-8000-000000000001', 'valid S90 source for bad child', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1500000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 17, 'f1450000-0000-4000-8000-000000000001', 'S80 not child of source', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1510000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 18, 'f1450000-0000-4000-8000-000000000001', 'accept instead of return source', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1520000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 19, 'f1510000-0000-4000-8000-000000000001', 'accept result', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1530000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 20, 'f1450000-0000-4000-8000-000000000001', 'missing decision source', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1540000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 21, 'f1530000-0000-4000-8000-000000000001', 'missing decision result', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1550000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 22, 'f1450000-0000-4000-8000-000000000001', 'wrong-result S90 source', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1560000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 23, 'f1550000-0000-4000-8000-000000000001', 'wrong-result S80 target', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1570000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 24, 'f1450000-0000-4000-8000-000000000001', 'stale current bridge', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1580000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 25, 'f1570000-0000-4000-8000-000000000001', 'stale S80 target', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap');

insert into public.capa_section_versions (
  section_version_id, organization_id, capa_case_id, section_type,
  version_number, schema_version, content, change_reason, effective_at,
  created_at, created_by_actor_type, created_by_actor_id
) values
  ('f1700000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'CAPA.ACTION_PLAN', 1, 'capa-action-plan-1.0.0', '{}'::jsonb, 'approved action plan', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'human', 'f1200000-0000-4000-8000-000000000001'),
  ('f1710000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'CAPA.IMPLEMENTATION_REVIEW_BASELINE', 1, 'capa-implementation-review-baseline-1.0.0', jsonb_build_object('approved_s70_baseline', jsonb_build_object('source_case_version_id', 'f1400000-0000-4000-8000-000000000001', 'approved_action_plan_section_id', 'f1700000-0000-4000-8000-000000000001', 'approval_decision_reference', 'f1800000-0000-4000-8000-000000000001'), 'source_s80_case_version_id', 'f1410000-0000-4000-8000-000000000001', 'resulting_s90_case_version_id', 'f1420000-0000-4000-8000-000000000001'), 'first review baseline', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'human', 'f1200000-0000-4000-8000-000000000001'),
  ('f1720000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'CAPA.IMPLEMENTATION_REVIEW_BASELINE', 2, 'capa-implementation-review-baseline-1.0.0', jsonb_build_object('approved_s70_baseline', jsonb_build_object('source_case_version_id', 'f1400000-0000-4000-8000-000000000001', 'approved_action_plan_section_id', 'f1700000-0000-4000-8000-000000000001', 'approval_decision_reference', 'f1800000-0000-4000-8000-000000000001'), 'source_s80_case_version_id', 'f1430000-0000-4000-8000-000000000001', 'resulting_s90_case_version_id', 'f1440000-0000-4000-8000-000000000001'), 'second review baseline', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'human', 'f1200000-0000-4000-8000-000000000001');

insert into public.capa_case_version_sections (
  organization_id, capa_case_id, case_version_id, section_version_id,
  display_order, created_at, created_by_actor_type, created_by_actor_id
) values
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1400000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1410000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1420000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1420000-0000-4000-8000-000000000001', 'f1710000-0000-4000-8000-000000000001', 1, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1430000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1430000-0000-4000-8000-000000000001', 'f1710000-0000-4000-8000-000000000001', 1, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1440000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1440000-0000-4000-8000-000000000001', 'f1720000-0000-4000-8000-000000000001', 1, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1450000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1450000-0000-4000-8000-000000000001', 'f1720000-0000-4000-8000-000000000001', 1, '2026-09-12T00:00:00Z', 'system', 'pg-tap');

insert into public.capa_audit_events (
  event_id, organization_id, event_type, schema_version, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_id, occurred_at,
  request_id, correlation_id, action, target_object_type, target_object_id,
  target_object_version_id, outcome, configuration_versions, metadata
) values
  ('f1800000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION', 'audit-1.0.0', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 8, 'human', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1810000-0000-4000-8000-000000000001', 'f1820000-0000-4000-8000-000000000001', 'DECIDE_CAPA_ACTION_PLAN', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 'f1410000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{}'::jsonb),
  ('f1830000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION', 'audit-1.0.0', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 10, 'human', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1840000-0000-4000-8000-000000000001', 'f1850000-0000-4000-8000-000000000001', 'DECIDE_CAPA_IMPLEMENTATION_REVIEW', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 'f1430000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{"from_state":"S90","to_state":"S80","transition_event":"Return for implementation","source_case_version_id":"f1420000-0000-4000-8000-000000000001","resulting_case_version_id":"f1430000-0000-4000-8000-000000000001","review_decision":"return","implementation_review_baseline_section_version_id":"f1710000-0000-4000-8000-000000000001"}'::jsonb),
  ('f1860000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION', 'audit-1.0.0', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 12, 'human', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1870000-0000-4000-8000-000000000001', 'f1880000-0000-4000-8000-000000000001', 'DECIDE_CAPA_IMPLEMENTATION_REVIEW', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 'f1450000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{"from_state":"S90","to_state":"S80","transition_event":"Return for implementation","source_case_version_id":"f1440000-0000-4000-8000-000000000001","resulting_case_version_id":"f1450000-0000-4000-8000-000000000001","review_decision":"return","implementation_review_baseline_section_version_id":"f1720000-0000-4000-8000-000000000001"}'::jsonb),
  ('f1890000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION', 'audit-1.0.0', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 19, 'human', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1900000-0000-4000-8000-000000000001', 'f1910000-0000-4000-8000-000000000001', 'DECIDE_CAPA_IMPLEMENTATION_REVIEW', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 'f1520000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{"from_state":"S90","to_state":"S80","transition_event":"Return for implementation","source_case_version_id":"f1510000-0000-4000-8000-000000000001","resulting_case_version_id":"f1520000-0000-4000-8000-000000000001","review_decision":"accept","implementation_review_baseline_section_version_id":"f1710000-0000-4000-8000-000000000001"}'::jsonb),
  ('f1920000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION', 'audit-1.0.0', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 12, 'human', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1930000-0000-4000-8000-000000000001', 'f1940000-0000-4000-8000-000000000001', 'DECIDE_CAPA_IMPLEMENTATION_REVIEW', 'CAPA_CASE', 'f1300000-0000-4000-8000-000000000001', 'f1450000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{}'::jsonb);

insert into public.capa_action_plan_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  action_plan_section_version_id, schema_version, decision, rationale,
  reviewer_user_id, decided_at, resulting_case_version_id,
  transition_audit_event_id
) values (
  'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1400000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', 'capa-action-plan-review-decision-1.0.0', 'approve', 'Approved implementation entry.', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1410000-0000-4000-8000-000000000001', 'f1800000-0000-4000-8000-000000000001'
);

insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1420000-0000-4000-8000-000000000001', 'f1710000-0000-4000-8000-000000000001', 'capa-implementation-review-decision-1.0.0', 'return', 'First implementation return.', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1430000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1440000-0000-4000-8000-000000000001', 'f1720000-0000-4000-8000-000000000001', 'capa-implementation-review-decision-1.0.0', 'return', 'Second implementation return.', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1450000-0000-4000-8000-000000000001', 'f1860000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1510000-0000-4000-8000-000000000001', 'f1710000-0000-4000-8000-000000000001', 'capa-implementation-review-decision-1.0.0', 'accept', 'Accept is not a return.', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1520000-0000-4000-8000-000000000001', 'f1890000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001', 'f1550000-0000-4000-8000-000000000001', 'f1710000-0000-4000-8000-000000000001', 'capa-implementation-review-decision-1.0.0', 'return', 'Wrong resulting version.', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f1450000-0000-4000-8000-000000000001', 'f1920000-0000-4000-8000-000000000001');

-- Isolated qualification case: every rollover prerequisite is valid except
-- the reviewed S90-to-baseline section relationship.
insert into public.capa_cases (
  capa_case_id, organization_id, case_number, current_version_id, status,
  owner_user_id, confidentiality, record_version, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'f2300000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001', 'CAPA-S80-ROLLOVER-ISOLATED',
  'f2410000-0000-4000-8000-000000000001', 'S80',
  'f1200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 8,
  '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap',
  '2026-09-12T00:00:00Z', 'system', 'pg-tap'
);

insert into public.capa_case_versions (
  case_version_id, organization_id, capa_case_id, version_number,
  parent_version_id, change_reason, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id
) values
  ('f2400000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 7, null, 'S70 baseline', 'S70', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f2410000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 8, 'f2400000-0000-4000-8000-000000000001', 'S80 first entry', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f2420000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 9, 'f2410000-0000-4000-8000-000000000001', 'S90 return review', 'S90', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f2430000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 10, 'f2420000-0000-4000-8000-000000000001', 'S80 return result', 'S80', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'system', 'pg-tap');

insert into public.capa_section_versions (
  section_version_id, organization_id, capa_case_id, section_type,
  version_number, schema_version, content, change_reason, effective_at,
  created_at, created_by_actor_type, created_by_actor_id
) values
  ('f2700000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'CAPA.ACTION_PLAN', 1, 'capa-action-plan-1.0.0', '{}'::jsonb, 'approved action plan', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'human', 'f1200000-0000-4000-8000-000000000001'),
  ('f2710000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'CAPA.IMPLEMENTATION_REVIEW_BASELINE', 1, 'capa-implementation-review-baseline-1.0.0', jsonb_build_object('approved_s70_baseline', jsonb_build_object('source_case_version_id', 'f2400000-0000-4000-8000-000000000001', 'approved_action_plan_section_id', 'f2700000-0000-4000-8000-000000000001', 'approval_decision_reference', 'f2800000-0000-4000-8000-000000000001'), 'source_s80_case_version_id', 'f2410000-0000-4000-8000-000000000001', 'resulting_s90_case_version_id', 'f2420000-0000-4000-8000-000000000001'), 'return review baseline', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'human', 'f1200000-0000-4000-8000-000000000001');

insert into public.capa_case_version_sections (
  organization_id, capa_case_id, case_version_id, section_version_id,
  display_order, created_at, created_by_actor_type, created_by_actor_id
) values
  ('f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2410000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2420000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2430000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001', 0, '2026-09-12T00:00:00Z', 'system', 'pg-tap'),
  ('f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2430000-0000-4000-8000-000000000001', 'f2710000-0000-4000-8000-000000000001', 1, '2026-09-12T00:00:00Z', 'system', 'pg-tap');

insert into public.capa_audit_events (
  event_id, organization_id, event_type, schema_version, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_id, occurred_at,
  request_id, correlation_id, action, target_object_type, target_object_id,
  target_object_version_id, outcome, configuration_versions, metadata
) values
  ('f2800000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION', 'audit-1.0.0', 'CAPA_CASE', 'f2300000-0000-4000-8000-000000000001', 8, 'human', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f2810000-0000-4000-8000-000000000001', 'f2820000-0000-4000-8000-000000000001', 'DECIDE_CAPA_ACTION_PLAN', 'CAPA_CASE', 'f2300000-0000-4000-8000-000000000001', 'f2410000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{}'::jsonb),
  ('f2830000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION', 'audit-1.0.0', 'CAPA_CASE', 'f2300000-0000-4000-8000-000000000001', 10, 'human', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f2840000-0000-4000-8000-000000000001', 'f2850000-0000-4000-8000-000000000001', 'DECIDE_CAPA_IMPLEMENTATION_REVIEW', 'CAPA_CASE', 'f2300000-0000-4000-8000-000000000001', 'f2430000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{"from_state":"S90","to_state":"S80","transition_event":"Return for implementation","source_case_version_id":"f2420000-0000-4000-8000-000000000001","resulting_case_version_id":"f2430000-0000-4000-8000-000000000001","review_decision":"return","implementation_review_baseline_section_version_id":"f2710000-0000-4000-8000-000000000001"}'::jsonb);

insert into public.capa_action_plan_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  action_plan_section_version_id, schema_version, decision, rationale,
  reviewer_user_id, decided_at, resulting_case_version_id,
  transition_audit_event_id
) values (
  'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2400000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001', 'capa-action-plan-review-decision-1.0.0', 'approve', 'Approved implementation entry.', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f2410000-0000-4000-8000-000000000001', 'f2800000-0000-4000-8000-000000000001'
);

insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001', 'f2420000-0000-4000-8000-000000000001', 'f2710000-0000-4000-8000-000000000001', 'capa-implementation-review-decision-1.0.0', 'return', 'Return with an intentionally missing baseline link.', 'f1200000-0000-4000-8000-000000000001', '2026-09-12T00:00:00Z', 'f2430000-0000-4000-8000-000000000001', 'f2830000-0000-4000-8000-000000000001'
);

set constraints all immediate;

select lives_ok($$
  insert into public.capa_implementation_workspace_drafts (
    organization_id, capa_case_id, case_version_id, record_version,
    source_case_version_id, approved_action_plan_section_id,
    approval_decision_reference, draft_revision, schema_version,
    workspace_draft, created_by_user_id, updated_by_user_id
  ) values (
    'f1000000-0000-4000-8000-000000000001', 'f1300000-0000-4000-8000-000000000001',
    'f1410000-0000-4000-8000-000000000001', 8,
    'f1400000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001',
    'f1800000-0000-4000-8000-000000000001', 1,
    'capa-implementation-workspace-draft-1.0.0', '{}'::jsonb,
    'f1200000-0000-4000-8000-000000000001', 'f1200000-0000-4000-8000-000000000001'
  )
$$, 'original S70 to S80 workspace insert succeeds');

select lives_ok($$
  update public.capa_implementation_workspace_drafts
  set draft_revision = 2, workspace_draft = '{"save":"original"}'::jsonb
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, 'ordinary save on the original S80 succeeds');

update public.capa_cases
set current_version_id = 'f1420000-0000-4000-8000-000000000001', status = 'S90', record_version = 9
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
update public.capa_cases
set current_version_id = 'f1430000-0000-4000-8000-000000000001', status = 'S80', record_version = 10
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';

select lives_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1430000-0000-4000-8000-000000000001', record_version = 10,
      draft_revision = 1, workspace_draft = '{"save":"returned-one"}'::jsonb
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, 'exact S80a to S90a to return to S80b rollover succeeds');

select lives_ok($$
  update public.capa_implementation_workspace_drafts
  set draft_revision = 2, workspace_draft = '{"save":"ordinary-returned"}'::jsonb
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, 'ordinary second save on returned S80b succeeds');

update public.capa_cases
set current_version_id = 'f1440000-0000-4000-8000-000000000001', status = 'S90', record_version = 11
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
update public.capa_cases
set current_version_id = 'f1450000-0000-4000-8000-000000000001', status = 'S80', record_version = 12
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';

select lives_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1450000-0000-4000-8000-000000000001', record_version = 12,
      draft_revision = 1, workspace_draft = '{"save":"returned-two"}'::jsonb
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, 'second S80b to S90b to return to S80c rollover succeeds');

select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set source_case_version_id = 'f1410000-0000-4000-8000-000000000001'
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'baseline mutation fails closed');

update public.capa_cases
set current_version_id = 'f1460000-0000-4000-8000-000000000001', status = 'S80', record_version = 13
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1460000-0000-4000-8000-000000000001', record_version = 13
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'unrelated S80 target and missing S90 parent fail closed');

update public.capa_cases
set current_version_id = 'f1470000-0000-4000-8000-000000000001', status = 'S90', record_version = 14
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
update public.capa_cases
set current_version_id = 'f1480000-0000-4000-8000-000000000001', status = 'S80', record_version = 15
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1480000-0000-4000-8000-000000000001', record_version = 15
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'S90 source not parent of old S80 fails closed');

update public.capa_cases
set current_version_id = 'f1490000-0000-4000-8000-000000000001', status = 'S90', record_version = 16
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
update public.capa_cases
set current_version_id = 'f1500000-0000-4000-8000-000000000001', status = 'S80', record_version = 17
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1500000-0000-4000-8000-000000000001', record_version = 17
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'new S80 not child of S90 source fails closed');

update public.capa_cases
set current_version_id = 'f1510000-0000-4000-8000-000000000001', status = 'S90', record_version = 18
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
update public.capa_cases
set current_version_id = 'f1520000-0000-4000-8000-000000000001', status = 'S80', record_version = 19
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1520000-0000-4000-8000-000000000001', record_version = 19
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'accept decision cannot authorize rollover');

update public.capa_cases
set current_version_id = 'f1530000-0000-4000-8000-000000000001', status = 'S90', record_version = 20
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
update public.capa_cases
set current_version_id = 'f1540000-0000-4000-8000-000000000001', status = 'S80', record_version = 21
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1540000-0000-4000-8000-000000000001', record_version = 21
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'decision with wrong or missing source fails closed');

update public.capa_cases
set current_version_id = 'f1550000-0000-4000-8000-000000000001', status = 'S90', record_version = 22
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
update public.capa_cases
set current_version_id = 'f1560000-0000-4000-8000-000000000001', status = 'S80', record_version = 23
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1560000-0000-4000-8000-000000000001', record_version = 23
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'decision with wrong resulting S80 fails closed');

select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set organization_id = 'f2000000-0000-4000-8000-000000000001',
      capa_case_id = 'f2300000-0000-4000-8000-000000000001'
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'wrong tenant or case fails closed');

update public.capa_cases
set current_version_id = 'f1580000-0000-4000-8000-000000000001', status = 'S80', record_version = 24
where organization_id = 'f1000000-0000-4000-8000-000000000001'
  and capa_case_id = 'f1300000-0000-4000-8000-000000000001';
select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f1580000-0000-4000-8000-000000000001', record_version = 25
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f1300000-0000-4000-8000-000000000001'
$$, '23514', null, 'stale non-current S80 context fails closed');

select lives_ok($$
  insert into public.capa_implementation_workspace_drafts (
    organization_id, capa_case_id, case_version_id, record_version,
    source_case_version_id, approved_action_plan_section_id,
    approval_decision_reference, draft_revision, schema_version,
    workspace_draft, created_by_user_id, updated_by_user_id
  ) values (
    'f1000000-0000-4000-8000-000000000001', 'f2300000-0000-4000-8000-000000000001',
    'f2410000-0000-4000-8000-000000000001', 8,
    'f2400000-0000-4000-8000-000000000001', 'f2700000-0000-4000-8000-000000000001',
    'f2800000-0000-4000-8000-000000000001', 1,
    'capa-implementation-workspace-draft-1.0.0', '{}'::jsonb,
    'f1200000-0000-4000-8000-000000000001', 'f1200000-0000-4000-8000-000000000001'
  )
$$, 'isolated case admits the valid original S80 workspace');

select lives_ok($$
  update public.capa_cases
  set current_version_id = 'f2420000-0000-4000-8000-000000000001', status = 'S90', record_version = 9
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f2300000-0000-4000-8000-000000000001'
$$, 'isolated case advances to the S90 review version');
select lives_ok($$
  update public.capa_cases
  set current_version_id = 'f2430000-0000-4000-8000-000000000001', status = 'S80', record_version = 10
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f2300000-0000-4000-8000-000000000001'
$$, 'isolated case current record points to the new S80 version');

select is(
  (select current_version_id from public.capa_cases
   where organization_id = 'f1000000-0000-4000-8000-000000000001'
     and capa_case_id = 'f2300000-0000-4000-8000-000000000001'),
  'f2430000-0000-4000-8000-000000000001',
  'isolated current CAPA version is exactly the new S80 version'
);
select is(
  (select record_version from public.capa_cases
   where organization_id = 'f1000000-0000-4000-8000-000000000001'
     and capa_case_id = 'f2300000-0000-4000-8000-000000000001'),
  10::bigint,
  'isolated current CAPA record_version matches the new S80 version'
);
select is(
  (select count(*)::integer from public.capa_case_version_sections
   where organization_id = 'f1000000-0000-4000-8000-000000000001'
     and capa_case_id = 'f2300000-0000-4000-8000-000000000001'
     and case_version_id = 'f2420000-0000-4000-8000-000000000001'
     and section_version_id = 'f2710000-0000-4000-8000-000000000001'),
  0,
  'only the reviewed baseline link to the source S90 is absent'
);
select throws_ok($$
  update public.capa_implementation_workspace_drafts
  set case_version_id = 'f2430000-0000-4000-8000-000000000001', record_version = 10
  where organization_id = 'f1000000-0000-4000-8000-000000000001'
    and capa_case_id = 'f2300000-0000-4000-8000-000000000001'
$$, '23514', null, 'missing reviewed baseline relationship fails closed in an otherwise valid rollover');

select is(
  (select case_version_id from public.capa_implementation_workspace_drafts
   where organization_id = 'f1000000-0000-4000-8000-000000000001'
     and capa_case_id = 'f2300000-0000-4000-8000-000000000001'),
  'f2410000-0000-4000-8000-000000000001',
  'isolated failed rollover never overwrites the admitted workspace'
);

select is(
  (select case_version_id from public.capa_implementation_workspace_drafts
   where organization_id = 'f1000000-0000-4000-8000-000000000001'
     and capa_case_id = 'f1300000-0000-4000-8000-000000000001'),
  'f1450000-0000-4000-8000-000000000001',
  'failed rollovers never overwrite the admitted authoritative workspace'
);

select * from finish();
rollback;
