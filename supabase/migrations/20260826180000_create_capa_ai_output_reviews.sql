begin;

-- ---------------------------------------------------------------------------
-- Governed human review of CAPA AI advisory outputs
-- ---------------------------------------------------------------------------
--
-- Human review is append-only and advisory-disposition only.
--
-- ACCEPT:
--   Accepts the AI proposal for the current review purpose only.
--   It does not approve a CAPA gate and does not mutate controlled CAPA data.
--
-- REJECT:
--   Rejects the AI proposal and requires human rationale.
--
-- REVISE:
--   Preserves the original AI output and records a separate human-authored
--   replacement proposal with required rationale.
--
-- Every review is:
--   * tenant bound,
--   * bound to the exact immutable AI output snapshot,
--   * attributable to a human,
--   * idempotency protected,
--   * linked to an immutable audit event,
--   * prohibited from mutating workflow or controlled CAPA state.
--
-- Traceability:
--   URS-AI-003
--   URS-AI-004
--   URS-WF-005 through URS-WF-007
--   SRS-REV-001 through SRS-REV-006
--   SRS-AC-003
--   SRS-AUD-001 through SRS-AUD-005
--   HRUI-D-001 through HRUI-D-008
--   HF-01, HF-02, HF-04, HF-07

-- ---------------------------------------------------------------------------
-- Harden existing governed AI outputs
-- ---------------------------------------------------------------------------
--
-- The original AI-output table was documented as immutable but did not yet
-- use the standard CAPA immutable-record trigger or FORCE ROW LEVEL SECURITY.
-- Human review depends on that output remaining an immutable source snapshot.

alter table public.capa_ai_outputs
  add constraint capa_ai_outputs_review_snapshot_unique
  unique (
    organization_id,
    output_id,
    capa_case_id,
    case_version_id,
    record_version,
    status
  );

create trigger capa_ai_outputs_reject_mutation
before update or delete
on public.capa_ai_outputs
for each row
execute function private.capa_reject_immutable_mutation();

alter table public.capa_ai_outputs
  force row level security;

revoke all
on table public.capa_ai_outputs
from public, anon, authenticated, service_role;

grant select, insert
on table public.capa_ai_outputs
to service_role;

-- ---------------------------------------------------------------------------
-- Immutable governed AI-output human reviews
-- ---------------------------------------------------------------------------

create table public.capa_ai_output_reviews (
  organization_id uuid not null,
  review_id uuid not null,

  output_id uuid not null,
  capa_case_id uuid not null,
  case_version_id uuid not null,
  record_version bigint not null,
  output_status text not null,

  decision text not null,
  rationale text,
  human_revision jsonb,

  reviewed_at timestamptz not null,
  reviewed_by_actor_type text not null,
  reviewed_by_actor_id text not null,
  reviewed_by_actor_version text,

  review_policy_version text not null,

  request_id uuid not null,
  correlation_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,

  audit_event_id uuid not null,

  review_record jsonb not null,
  record_fingerprint_algorithm text not null,
  record_fingerprint text not null,

  workflow_mutated boolean not null
    default false,

  controlled_record_mutated boolean not null
    default false,

  gate_approved boolean not null
    default false,

  created_at timestamptz not null
    default statement_timestamp(),

  constraint capa_ai_output_reviews_pkey
    primary key (
      organization_id,
      review_id
    ),

  constraint capa_ai_output_reviews_idempotency_unique
    unique (
      organization_id,
      idempotency_key
    ),

  constraint capa_ai_output_reviews_audit_event_unique
    unique (
      organization_id,
      audit_event_id
    ),

  constraint capa_ai_output_reviews_organization_fk
    foreign key (
      organization_id
    )
    references public.capa_organizations (
      organization_id
    )
    on update restrict
    on delete restrict,

  constraint capa_ai_output_reviews_output_snapshot_fk
    foreign key (
      organization_id,
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      output_status
    )
    references public.capa_ai_outputs (
      organization_id,
      output_id,
      capa_case_id,
      case_version_id,
      record_version,
      status
    )
    on update restrict
    on delete restrict,

  constraint capa_ai_output_reviews_audit_event_fk
    foreign key (
      organization_id,
      audit_event_id
    )
    references public.capa_audit_events (
      organization_id,
      event_id
    )
    on update restrict
    on delete restrict
    deferrable initially deferred,

  constraint capa_ai_output_reviews_record_version_positive
    check (
      record_version > 0
    ),

  constraint capa_ai_output_reviews_completed_output_only
    check (
      output_status = 'completed_draft'
    ),

  constraint capa_ai_output_reviews_decision_valid
    check (
      decision in (
        'accept',
        'reject',
        'revise'
      )
    ),

  constraint capa_ai_output_reviews_rationale_format
    check (
      rationale is null
      or (
        rationale = btrim(rationale)
        and char_length(rationale)
          between 3 and 4000
      )
    ),

  constraint capa_ai_output_reviews_human_revision_object
    check (
      human_revision is null
      or (
        jsonb_typeof(human_revision) = 'object'

        and human_revision ?& array[
          'problem_statement_draft',
          'scope_dimensions',
          'missing_dimensions',
          'containment_risk_questions',
          'investigation_questions'
        ]::text[]

        and (
          human_revision
          - array[
              'problem_statement_draft',
              'scope_dimensions',
              'missing_dimensions',
              'containment_risk_questions',
              'investigation_questions'
            ]::text[]
        ) = '{}'::jsonb

        and jsonb_typeof(
          human_revision ->
            'problem_statement_draft'
        ) = 'string'

        and jsonb_typeof(
          human_revision ->
            'scope_dimensions'
        ) = 'array'

        and jsonb_typeof(
          human_revision ->
            'missing_dimensions'
        ) = 'array'

        and jsonb_typeof(
          human_revision ->
            'containment_risk_questions'
        ) = 'array'

        and jsonb_typeof(
          human_revision ->
            'investigation_questions'
        ) = 'array'
      )
    ),

  constraint capa_ai_output_reviews_disposition_shape
    check (
      (
        decision = 'accept'
        and human_revision is null
      )
      or
      (
        decision = 'reject'
        and rationale is not null
        and human_revision is null
      )
      or
      (
        decision = 'revise'
        and rationale is not null
        and human_revision is not null
      )
    ),

  constraint capa_ai_output_reviews_human_reviewer
    check (
      reviewed_by_actor_type = 'human'
    ),

  constraint capa_ai_output_reviews_reviewer_id_format
    check (
      reviewed_by_actor_id =
        btrim(reviewed_by_actor_id)
      and char_length(
        reviewed_by_actor_id
      ) between 1 and 256
    ),

  constraint capa_ai_output_reviews_reviewer_version_format
    check (
      reviewed_by_actor_version is null
      or (
        reviewed_by_actor_version =
          btrim(reviewed_by_actor_version)
        and char_length(
          reviewed_by_actor_version
        ) between 1 and 128
      )
    ),

  constraint capa_ai_output_reviews_policy_version_format
    check (
      review_policy_version =
        btrim(review_policy_version)
      and review_policy_version ~
        '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),

  constraint capa_ai_output_reviews_idempotency_key_format
    check (
      idempotency_key =
        btrim(idempotency_key)
      and char_length(
        idempotency_key
      ) between 1 and 128
    ),

  constraint capa_ai_output_reviews_request_fingerprint_format
    check (
      request_fingerprint ~
        '^[0-9a-f]{64}$'
    ),

  constraint capa_ai_output_reviews_review_record_object
    check (
      jsonb_typeof(
        review_record
      ) = 'object'
    ),

  constraint capa_ai_output_reviews_fingerprint_algorithm
    check (
      record_fingerprint_algorithm =
        'sha256'
    ),

  constraint capa_ai_output_reviews_record_fingerprint_format
    check (
      record_fingerprint ~
        '^[0-9a-f]{64}$'
    ),

  constraint capa_ai_output_reviews_no_workflow_mutation
    check (
      workflow_mutated = false
    ),

  constraint capa_ai_output_reviews_no_controlled_record_mutation
    check (
      controlled_record_mutated = false
    ),

  constraint capa_ai_output_reviews_not_gate_approval
    check (
      gate_approved = false
    ),

  constraint capa_ai_output_reviews_recording_time
    check (
      created_at >=
        reviewed_at - interval '5 minutes'
    )
);

-- ---------------------------------------------------------------------------
-- Query support
-- ---------------------------------------------------------------------------

create index capa_ai_output_reviews_output_history_idx
  on public.capa_ai_output_reviews (
    organization_id,
    output_id,
    reviewed_at desc,
    review_id desc
  );

create index capa_ai_output_reviews_case_history_idx
  on public.capa_ai_output_reviews (
    organization_id,
    capa_case_id,
    reviewed_at desc,
    review_id desc
  );

create index capa_ai_output_reviews_correlation_idx
  on public.capa_ai_output_reviews (
    organization_id,
    correlation_id
  );

create index capa_ai_output_reviews_request_idx
  on public.capa_ai_output_reviews (
    organization_id,
    request_id
  );

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create trigger capa_ai_output_reviews_reject_mutation
before update or delete
on public.capa_ai_output_reviews
for each row
execute function private.capa_reject_immutable_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security and least privilege
-- ---------------------------------------------------------------------------
--
-- Browser roles receive no direct access. Trusted application services use
-- service_role inside controlled transaction boundaries.

alter table public.capa_ai_output_reviews
  enable row level security;

alter table public.capa_ai_output_reviews
  force row level security;

revoke all
on table public.capa_ai_output_reviews
from public, anon, authenticated, service_role;

grant select, insert
on table public.capa_ai_output_reviews
to service_role;

-- ---------------------------------------------------------------------------
-- Controlled documentation
-- ---------------------------------------------------------------------------

comment on table public.capa_ai_output_reviews is
  'Immutable server-only human dispositions of governed CAPA AI advisory outputs. Accept, reject and revise remain distinct from CAPA workflow transition, controlled-record mutation and gate approval.';

comment on column
public.capa_ai_output_reviews.output_id is
  'Exact immutable governed AI advisory output reviewed by the human.';

comment on column
public.capa_ai_output_reviews.case_version_id is
  'Exact immutable CAPA case version against which the reviewed AI output was generated.';

comment on column
public.capa_ai_output_reviews.record_version is
  'Optimistic-concurrency record version captured by the governed AI output and human review.';

comment on column
public.capa_ai_output_reviews.decision is
  'Human disposition for this review purpose only: accept, reject or revise. Accept is not CAPA gate approval.';

comment on column
public.capa_ai_output_reviews.human_revision is
  'Human-authored replacement proposal for revise dispositions. The original AI proposal remains immutable in capa_ai_outputs.';

comment on column
public.capa_ai_output_reviews.idempotency_key is
  'Organization-local opaque request key used to make exact human-review retries safe.';

comment on column
public.capa_ai_output_reviews.request_fingerprint is
  'Lowercase hexadecimal SHA-256 digest of the canonical governed human-review request.';

comment on column
public.capa_ai_output_reviews.audit_event_id is
  'Immutable audit-event identity committed atomically with the human review disposition.';

comment on column
public.capa_ai_output_reviews.review_record is
  'Self-contained immutable validated human-review record persisted for durable disposition evidence.';

comment on column
public.capa_ai_output_reviews.record_fingerprint is
  'Lowercase SHA-256 fingerprint of the canonical persisted human-review record.';

comment on column
public.capa_ai_output_reviews.workflow_mutated is
  'Safety assertion permanently constrained to false; human AI-output review does not transition CAPA workflow.';

comment on column
public.capa_ai_output_reviews.controlled_record_mutated is
  'Safety assertion permanently constrained to false; this review operation does not mutate controlled CAPA content.';

comment on column
public.capa_ai_output_reviews.gate_approved is
  'Safety assertion permanently constrained to false; accepting an AI advisory output is not CAPA gate approval.';

commit;
