begin;

-- ---------------------------------------------------------------------------
-- Immutable, selective human adoption evidence for S30 AG-PLAN proposals.
-- ---------------------------------------------------------------------------
--
-- This table records human intent and provenance only. It is deliberately
-- separate from capa_ai_output_reviews because selective proposal adoption is
-- not intake-output disposition and does not mutate a controlled CAPA plan.
-- The future S30 adoption service may bind adoption_id as the plan item's
-- draft_provenance.source_reference after reloading and verifying this row.

create table public.capa_investigation_planning_ai_adoptions (
  organization_id uuid not null,
  adoption_id uuid not null,

  output_id uuid not null,
  capa_case_id uuid not null,
  case_version_id uuid not null,
  record_version bigint not null,
  output_status text not null,
  proposal_key text not null,

  adopted_item jsonb not null,
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

  constraint capa_s30_adoptions_pkey
    primary key (organization_id, adoption_id),

  constraint capa_s30_adoptions_idempotency_unique
    unique (organization_id, idempotency_key, proposal_key),

  constraint capa_s30_adoptions_audit_event_unique
    unique (organization_id, audit_event_id),

  constraint capa_s30_adoptions_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict,

  constraint capa_s30_adoptions_output_snapshot_fk
    foreign key (
      organization_id, output_id, capa_case_id, case_version_id,
      record_version, output_status
    )
    references public.capa_ai_outputs (
      organization_id, output_id, capa_case_id, case_version_id,
      record_version, status
    )
    on update restrict on delete restrict,

  constraint capa_s30_adoptions_audit_event_fk
    foreign key (organization_id, audit_event_id)
    references public.capa_audit_events (organization_id, event_id)
    on update restrict on delete restrict
    deferrable initially deferred,

  constraint capa_s30_adoptions_record_version_positive
    check (record_version > 0),

  constraint capa_s30_adoptions_completed_output_only
    check (output_status = 'completed_draft'),

  constraint capa_s30_adoptions_proposal_key_format
    check (proposal_key ~ '^P[1-9][0-9]{0,2}$'),

  constraint capa_s30_adoptions_adopted_item_object
    check (
      jsonb_typeof(adopted_item) = 'object'
      and adopted_item ?& array[
        'proposal_key',
        'investigation_question',
        'evidence_target',
        'investigation_method',
        'scope_relationship',
        'owner_user_id',
        'due_date',
        'dependency_proposal_keys'
      ]::text[]
      and (
        adopted_item - array[
          'proposal_key',
          'investigation_question',
          'evidence_target',
          'investigation_method',
          'scope_relationship',
          'owner_user_id',
          'due_date',
          'dependency_proposal_keys'
        ]::text[]
      ) = '{}'::jsonb
      and adopted_item ->> 'proposal_key' = proposal_key
      and jsonb_typeof(adopted_item -> 'dependency_proposal_keys') = 'array'
      and jsonb_typeof(adopted_item -> 'owner_user_id') in ('string', 'null')
      and jsonb_typeof(adopted_item -> 'due_date') in ('string', 'null')
    ),

  constraint capa_s30_adoptions_adoption_record_object
    check (
      jsonb_typeof(adoption_record) = 'object'
      and adoption_record ->> 'adoption_id' = adoption_id::text
      and adoption_record ->> 'organization_id' = organization_id::text
      and adoption_record ->> 'capa_case_id' = capa_case_id::text
      and adoption_record ->> 'case_version_id' = case_version_id::text
      and (adoption_record ->> 'record_version')::bigint = record_version
      and adoption_record ->> 'output_id' = output_id::text
      and adoption_record ->> 'proposal_key' = proposal_key
      and adoption_record ->> 'adopted_by' is not null
      and adoption_record -> 'workflow_mutated' = 'false'::jsonb
      and adoption_record -> 'controlled_record_mutated' = 'false'::jsonb
      and adoption_record -> 'gate_approved' = 'false'::jsonb
    ),

  constraint capa_s30_adoptions_human_adopter
    check (adopted_by_actor_type = 'human'),

  constraint capa_s30_adoptions_adopter_id_format
    check (
      adopted_by_actor_id = btrim(adopted_by_actor_id)
      and char_length(adopted_by_actor_id) between 1 and 256
    ),

  constraint capa_s30_adoptions_policy_format
    check (
      adoption_policy_version = btrim(adoption_policy_version)
      and adoption_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),

  constraint capa_s30_adoptions_idempotency_format
    check (
      idempotency_key = btrim(idempotency_key)
      and char_length(idempotency_key) between 1 and 128
    ),

  constraint capa_s30_adoptions_request_fingerprint_format
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),

  constraint capa_s30_adoptions_record_fingerprint_algorithm
    check (record_fingerprint_algorithm = 'sha256'),

  constraint capa_s30_adoptions_record_fingerprint_format
    check (record_fingerprint ~ '^[0-9a-f]{64}$'),

  constraint capa_s30_adoptions_no_workflow_mutation
    check (workflow_mutated = false),

  constraint capa_s30_adoptions_no_controlled_record_mutation
    check (controlled_record_mutated = false),

  constraint capa_s30_adoptions_not_gate_approval
    check (gate_approved = false)
);

create index capa_s30_adoptions_output_history_idx
  on public.capa_investigation_planning_ai_adoptions (
    organization_id, output_id, adopted_at asc, adoption_id asc
  );

create index capa_s30_adoptions_case_history_idx
  on public.capa_investigation_planning_ai_adoptions (
    organization_id, capa_case_id, adopted_at asc
  );

create index capa_s30_adoptions_correlation_idx
  on public.capa_investigation_planning_ai_adoptions (
    organization_id, correlation_id
  );

create trigger capa_s30_adoptions_reject_mutation
before update or delete
on public.capa_investigation_planning_ai_adoptions
for each row
execute function private.capa_reject_immutable_mutation();

alter table public.capa_investigation_planning_ai_adoptions
  enable row level security;

alter table public.capa_investigation_planning_ai_adoptions
  force row level security;

revoke all
  on table public.capa_investigation_planning_ai_adoptions
  from public, anon, authenticated, service_role;

grant select, insert
  on table public.capa_investigation_planning_ai_adoptions
  to service_role;

comment on table public.capa_investigation_planning_ai_adoptions is
  'Immutable human evidence for selective S30 AG-PLAN proposal adoption; not a controlled CAPA investigation-plan section or workflow mutation.';

comment on column public.capa_investigation_planning_ai_adoptions.adoption_id is
  'Server-generated immutable identity intended for future draft_provenance.source_reference binding.';

commit;
