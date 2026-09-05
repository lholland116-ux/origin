begin;

-- Immutable human adoption/provenance evidence for S40 AG-RCA proposals.
-- This row never mutates the controlled ledger, root-cause package, or workflow.
create table public.capa_investigation_active_ai_adoptions (
  organization_id uuid not null,
  adoption_id uuid not null,
  output_id uuid not null,
  output_run_id uuid not null,
  capa_case_id uuid not null,
  case_version_id uuid not null,
  record_version bigint not null,
  output_status text not null,
  output_request_id uuid not null,
  output_correlation_id uuid not null,
  proposal_key text not null,
  proposal_category text not null,
  adopted_item jsonb not null,
  resolved_reference_bindings jsonb not null,
  reference_manifest_schema_version text not null,
  reference_manifest_fingerprint_algorithm text not null,
  reference_manifest_sha256 text not null,
  adopted_at timestamptz not null,
  adopted_by_actor_type text not null,
  adopted_by_actor_id text not null,
  adoption_policy_version text not null,
  request_id uuid not null,
  correlation_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  audit_event_id uuid not null,
  adoption_record jsonb not null,
  record_fingerprint_algorithm text not null,
  record_fingerprint text not null,
  workflow_mutated boolean not null default false,
  controlled_record_mutated boolean not null default false,
  gate_approved boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),

  constraint capa_s40_adoptions_pkey primary key (organization_id, adoption_id),
  constraint capa_s40_adoptions_idempotency_unique unique (organization_id, idempotency_key, proposal_key),
  constraint capa_s40_adoptions_audit_unique unique (organization_id, audit_event_id),
  constraint capa_s40_adoptions_organization_fk foreign key (organization_id)
    references public.capa_organizations (organization_id) on update restrict on delete restrict,
  constraint capa_s40_adoptions_output_fk foreign key (
    organization_id, output_id, output_run_id, capa_case_id, case_version_id,
    record_version, output_request_id, output_correlation_id, output_status
  ) references public.capa_ai_outputs (
    organization_id, output_id, run_id, capa_case_id, case_version_id,
    record_version, request_id, correlation_id, status
  ) on update restrict on delete restrict,
  constraint capa_s40_adoptions_manifest_fk foreign key (organization_id, output_id)
    references public.capa_ai_reference_manifests (organization_id, output_id)
    on update restrict on delete restrict,
  constraint capa_s40_adoptions_audit_fk foreign key (organization_id, audit_event_id)
    references public.capa_audit_events (organization_id, event_id)
    on update restrict on delete restrict deferrable initially deferred,
  constraint capa_s40_adoptions_record_version_positive check (record_version > 0),
  constraint capa_s40_adoptions_completed_output check (output_status = 'completed_draft'),
  constraint capa_s40_adoptions_category check (proposal_category in (
    'evidence_gap', 'conflicting_information', 'assumption',
    'causal_hypothesis', 'alternative_hypothesis', 'investigation_recommendation'
  )),
  constraint capa_s40_adoptions_proposal_key check (proposal_key ~ '^P[1-9][0-9]{0,2}$'),
  constraint capa_s40_adoptions_adopted_item_object check (
    jsonb_typeof(adopted_item) = 'object' and adopted_item ->> 'proposal_key' = proposal_key
  ),
  constraint capa_s40_adoptions_bindings_array check (jsonb_typeof(resolved_reference_bindings) = 'array'),
  constraint capa_s40_adoptions_manifest_schema check (reference_manifest_schema_version = 'capa-investigation-active-reference-manifest-1.0.0'),
  constraint capa_s40_adoptions_manifest_algorithm check (reference_manifest_fingerprint_algorithm = 'sha256-canonical-json-v1'),
  constraint capa_s40_adoptions_manifest_sha check (reference_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint capa_s40_adoptions_human check (adopted_by_actor_type = 'human'),
  constraint capa_s40_adoptions_policy check (adoption_policy_version = 'capa-investigation-active-adoption-1.0.0'),
  constraint capa_s40_adoptions_idempotency check (idempotency_key = btrim(idempotency_key) and char_length(idempotency_key) between 1 and 128),
  constraint capa_s40_adoptions_request_sha check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint capa_s40_adoptions_record_algorithm check (record_fingerprint_algorithm = 'sha256'),
  constraint capa_s40_adoptions_record_sha check (record_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint capa_s40_adoptions_record_object check (
    jsonb_typeof(adoption_record) = 'object' and
    adoption_record ->> 'adoption_id' = adoption_id::text and
    adoption_record ->> 'organization_id' = organization_id::text and
    adoption_record ->> 'capa_case_id' = capa_case_id::text and
    adoption_record ->> 'case_version_id' = case_version_id::text and
    adoption_record ->> 'output_id' = output_id::text and
    adoption_record ->> 'proposal_key' = proposal_key and
    adoption_record -> 'workflow_mutated' = 'false'::jsonb and
    adoption_record -> 'controlled_record_mutated' = 'false'::jsonb and
    adoption_record -> 'gate_approved' = 'false'::jsonb
  ),
  constraint capa_s40_adoptions_no_workflow check (workflow_mutated = false),
  constraint capa_s40_adoptions_no_controlled_mutation check (controlled_record_mutated = false),
  constraint capa_s40_adoptions_not_gate check (gate_approved = false)
);

create index capa_s40_adoptions_output_history_idx on public.capa_investigation_active_ai_adoptions
  (organization_id, output_id, adopted_at asc, adoption_id asc);
create index capa_s40_adoptions_case_history_idx on public.capa_investigation_active_ai_adoptions
  (organization_id, capa_case_id, adopted_at asc);

create trigger capa_s40_adoptions_reject_mutation
before update or delete on public.capa_investigation_active_ai_adoptions
for each row execute function private.capa_reject_immutable_mutation();

alter table public.capa_investigation_active_ai_adoptions enable row level security;
alter table public.capa_investigation_active_ai_adoptions force row level security;
revoke all on table public.capa_investigation_active_ai_adoptions from public, anon, authenticated, service_role;
grant select, insert on table public.capa_investigation_active_ai_adoptions to service_role;

comment on table public.capa_investigation_active_ai_adoptions is
  'Immutable human adoption/provenance evidence for S40 AG-RCA proposals; it does not mutate controlled CAPA state or approve workflow.';

commit;
