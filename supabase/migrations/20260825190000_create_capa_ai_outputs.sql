begin;

create table public.capa_ai_outputs (
  organization_id uuid not null,
  output_id uuid not null,
  run_id uuid not null,

  capa_case_id uuid not null,
  case_version_id uuid not null,
  record_version bigint not null,

  request_id uuid not null,
  correlation_id uuid not null,

  agent_id text not null,
  agent_version text not null,
  output_schema_version text not null,

  status text not null,

  proposal jsonb,
  citations jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  conflicts_and_alternatives jsonb not null default '[]'::jsonb,
  uncertainty_and_limitations jsonb not null default '[]'::jsonb,
  human_action_required jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,

  advisory_only boolean not null,
  workflow_mutated boolean not null,
  human_acceptance_required boolean not null,

  created_at timestamptz not null default now(),

  constraint capa_ai_outputs_pkey
    primary key (organization_id, output_id),

  constraint capa_ai_outputs_run_unique
    unique (organization_id, run_id),

  constraint capa_ai_outputs_record_version_positive
    check (record_version > 0),

  constraint capa_ai_outputs_status_valid
    check (
      status in (
        'completed_draft',
        'validation_failed',
        'service_failed'
      )
    ),

  constraint capa_ai_outputs_advisory_only
    check (advisory_only = true),

  constraint capa_ai_outputs_no_workflow_mutation
    check (workflow_mutated = false),

  constraint capa_ai_outputs_human_acceptance_required
    check (human_acceptance_required = true),

  constraint capa_ai_outputs_case_fk
    foreign key (
      organization_id,
      capa_case_id
    )
    references public.capa_cases (
      organization_id,
      capa_case_id
    ),

  constraint capa_ai_outputs_case_version_fk
    foreign key (
      organization_id,
      case_version_id
    )
    references public.capa_case_versions (
      organization_id,
      case_version_id
    )
);

create index capa_ai_outputs_case_created_idx
  on public.capa_ai_outputs (
    organization_id,
    capa_case_id,
    created_at desc
  );

create index capa_ai_outputs_correlation_idx
  on public.capa_ai_outputs (
    organization_id,
    correlation_id
  );

alter table public.capa_ai_outputs
  enable row level security;

revoke all
  on public.capa_ai_outputs
  from anon, authenticated;

comment on table public.capa_ai_outputs is
  'Immutable governed CAPA AI advisory outputs. Server-controlled persistence only; AI output never constitutes workflow mutation or human approval.';

comment on column public.capa_ai_outputs.run_id is
  'Server-controlled AI run identity shared with the governed prompt trace.';

comment on column public.capa_ai_outputs.output_id is
  'Immutable identity of the validated AI advisory output.';

commit;
