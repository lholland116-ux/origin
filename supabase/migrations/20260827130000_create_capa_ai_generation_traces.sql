begin;

-- ---------------------------------------------------------------------------
-- Durable immutable CAPA AI generation trace
-- ---------------------------------------------------------------------------
--
-- Every newly persisted governed CAPA AI advisory output must be bound to the
-- exact controlled prompt package, admitted evidence, controlled policy
-- versions, and exact rendered model-input fingerprint that produced it.
--
-- Historical AI outputs created before this migration are intentionally not
-- backfilled because their exact in-memory generation artifacts cannot be
-- reconstructed with sufficient evidentiary confidence.
--
-- The application inserts capa_ai_outputs and capa_ai_generation_traces inside
-- one transaction. A failure of either write prevents the pair from committing.
--
-- Traceability:
--   M5 Closure Corrective Action CA-1
--   Immutable prompt / evidence / policy trace
-- ---------------------------------------------------------------------------

alter table public.capa_ai_outputs
  add constraint capa_ai_outputs_generation_trace_unique
  unique (
    organization_id,
    output_id,
    run_id,
    capa_case_id,
    case_version_id,
    record_version,
    status
  );

create table public.capa_ai_generation_traces (
  organization_id uuid not null,
  run_id uuid not null,
  output_id uuid not null,

  capa_case_id uuid not null,
  case_version_id uuid not null,
  record_version bigint not null,
  output_status text not null,

  request_id uuid not null,
  correlation_id uuid not null,

  prompt_package_id uuid not null,

  trace_schema_version text not null,
  fingerprint_algorithm text not null,

  prompt_package jsonb not null,
  prompt_package_sha256 text not null,
  rendered_prompt_sha256 text not null,

  evidence_manifest jsonb not null,
  evidence_manifest_sha256 text not null,

  policy_manifest jsonb not null,
  policy_manifest_sha256 text not null,

  model_profile_version text not null,

  assembled_at timestamptz not null,
  created_at timestamptz not null
    default statement_timestamp(),

  constraint capa_ai_generation_traces_pkey
    primary key (
      organization_id,
      run_id
    ),

  constraint capa_ai_generation_traces_output_unique
    unique (
      organization_id,
      output_id
    ),

  constraint capa_ai_generation_traces_prompt_package_unique
    unique (
      organization_id,
      prompt_package_id
    ),

  constraint capa_ai_generation_traces_output_fk
    foreign key (
      organization_id,
      output_id,
      run_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status
    )
    references public.capa_ai_outputs (
      organization_id,
      output_id,
      run_id,
      capa_case_id,
      case_version_id,
      record_version,
      status
    )
    on update restrict
    on delete restrict,

  constraint capa_ai_generation_traces_record_version_positive
    check (
      record_version > 0
    ),

  constraint capa_ai_generation_traces_trace_schema_version
    check (
      trace_schema_version =
        'capa-ai-generation-trace-1.0.0'
    ),

  constraint capa_ai_generation_traces_fingerprint_algorithm
    check (
      fingerprint_algorithm =
        'sha256-canonical-json-v1'
    ),

  constraint capa_ai_generation_traces_prompt_package_object
    check (
      jsonb_typeof(prompt_package) = 'object'
    ),

  constraint capa_ai_generation_traces_evidence_manifest_object
    check (
      jsonb_typeof(evidence_manifest) = 'object'
    ),

  constraint capa_ai_generation_traces_policy_manifest_object
    check (
      jsonb_typeof(policy_manifest) = 'object'
    ),

  constraint capa_ai_generation_traces_prompt_package_sha256
    check (
      prompt_package_sha256 ~ '^[0-9a-f]{64}$'
    ),

  constraint capa_ai_generation_traces_rendered_prompt_sha256
    check (
      rendered_prompt_sha256 ~ '^[0-9a-f]{64}$'
    ),

  constraint capa_ai_generation_traces_evidence_manifest_sha256
    check (
      evidence_manifest_sha256 ~ '^[0-9a-f]{64}$'
    ),

  constraint capa_ai_generation_traces_policy_manifest_sha256
    check (
      policy_manifest_sha256 ~ '^[0-9a-f]{64}$'
    ),

  constraint capa_ai_generation_traces_model_profile_version_format
    check (
      model_profile_version =
        btrim(model_profile_version)
      and char_length(model_profile_version)
        between 1 and 100
    )
);

create index capa_ai_generation_traces_case_idx
  on public.capa_ai_generation_traces (
    organization_id,
    capa_case_id,
    assembled_at desc
  );

create index capa_ai_generation_traces_correlation_idx
  on public.capa_ai_generation_traces (
    organization_id,
    correlation_id
  );

create trigger capa_ai_generation_traces_reject_mutation
before update or delete
on public.capa_ai_generation_traces
for each row
execute function private.capa_reject_immutable_mutation();

alter table public.capa_ai_generation_traces
  enable row level security;

alter table public.capa_ai_generation_traces
  force row level security;

revoke all
on table public.capa_ai_generation_traces
from public, anon, authenticated, service_role;

grant select, insert
on table public.capa_ai_generation_traces
to service_role;

comment on table public.capa_ai_generation_traces is
  'Immutable server-controlled provenance for governed CAPA AI generation. New AI outputs are atomically bound to the exact prompt package and prompt/evidence/policy fingerprints. Historical pre-trace outputs are intentionally not backfilled.';

comment on column public.capa_ai_generation_traces.run_id is
  'Server-controlled AI run identity shared with the corresponding immutable capa_ai_outputs row.';

comment on column public.capa_ai_generation_traces.prompt_package is
  'Exact controlled prompt package assembled before model invocation. The raw separately rendered model-input string is not stored.';

comment on column public.capa_ai_generation_traces.rendered_prompt_sha256 is
  'SHA-256 of the exact UTF-8 rendered prompt string submitted to the structured model boundary.';

commit;
