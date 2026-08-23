begin;

-- ---------------------------------------------------------------------------
-- Transactional CAPA workflow-operation idempotency
-- ---------------------------------------------------------------------------
--
-- One immutable row binds an organization-local idempotency key to a
-- controlled workflow operation, canonical request fingerprint, CAPA case,
-- source version, resulting version and audit event.
--
-- The reservation is inserted before the resulting case version and inside
-- the same transaction as aggregate advancement and audit persistence.
-- Deferred foreign keys permit that reservation-first ordering while ensuring
-- that no incomplete binding can commit.

create table public.capa_workflow_idempotency (
  organization_id uuid not null,
  idempotency_key text not null,
  operation_code text not null,
  request_fingerprint text not null,
  capa_case_id uuid not null,
  source_case_version_id uuid not null,
  resulting_case_version_id uuid not null,
  audit_event_id uuid not null,
  created_at timestamptz not null
    default statement_timestamp(),

  primary key (
    organization_id,
    idempotency_key
  ),

  constraint capa_workflow_idempotency_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (
      organization_id
    )
    on update restrict
    on delete restrict
    deferrable initially deferred,

  constraint capa_workflow_idempotency_case_fk
    foreign key (
      organization_id,
      capa_case_id
    )
    references public.capa_cases (
      organization_id,
      capa_case_id
    )
    on update restrict
    on delete restrict
    deferrable initially deferred,

  constraint capa_workflow_idempotency_source_version_fk
    foreign key (
      organization_id,
      capa_case_id,
      source_case_version_id
    )
    references public.capa_case_versions (
      organization_id,
      capa_case_id,
      case_version_id
    )
    on update restrict
    on delete restrict
    deferrable initially deferred,

  constraint capa_workflow_idempotency_resulting_version_fk
    foreign key (
      organization_id,
      capa_case_id,
      resulting_case_version_id
    )
    references public.capa_case_versions (
      organization_id,
      capa_case_id,
      case_version_id
    )
    on update restrict
    on delete restrict
    deferrable initially deferred,

  constraint capa_workflow_idempotency_audit_event_fk
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

  constraint capa_workflow_idempotency_key_format
    check (
      idempotency_key = btrim(idempotency_key)
      and char_length(idempotency_key)
        between 1 and 128
    ),

  constraint capa_workflow_idempotency_operation_format
    check (
      char_length(operation_code)
        between 1 and 64
      and operation_code ~
        '^[A-Za-z][A-Za-z0-9._:-]*$'
    ),

  constraint capa_workflow_idempotency_fingerprint_format
    check (
      request_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint capa_workflow_idempotency_distinct_versions
    check (
      source_case_version_id <>
      resulting_case_version_id
    )
);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create trigger capa_workflow_idempotency_reject_mutation
before update or delete
on public.capa_workflow_idempotency
for each row
execute function private.capa_reject_immutable_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security and least privilege
-- ---------------------------------------------------------------------------
--
-- This is an internal transaction-control ledger. Browser roles receive no
-- direct access. Trusted server-side workflow commands use service_role
-- credentials within controlled transactions.

alter table public.capa_workflow_idempotency
enable row level security;

alter table public.capa_workflow_idempotency
force row level security;

revoke all
on table public.capa_workflow_idempotency
from public, anon, authenticated, service_role;

grant select, insert
on table public.capa_workflow_idempotency
to service_role;

-- ---------------------------------------------------------------------------
-- Controlled documentation
-- ---------------------------------------------------------------------------

comment on table public.capa_workflow_idempotency is
  'Immutable server-only ledger binding an organization-local idempotency key, controlled workflow operation and SHA-256 request fingerprint to one CAPA version transition and audit event.';

comment on column
public.capa_workflow_idempotency.organization_id is
  'Permanent tenant boundary within which the workflow idempotency key is unique.';

comment on column
public.capa_workflow_idempotency.idempotency_key is
  'Opaque client request key retained for safe exact workflow retries; never interpreted as business data.';

comment on column
public.capa_workflow_idempotency.operation_code is
  'Controlled workflow action bound to the key, such as SUBMIT_CAPA_INTAKE.';

comment on column
public.capa_workflow_idempotency.request_fingerprint is
  'Lowercase hexadecimal SHA-256 digest of the canonical controlled workflow request.';

comment on column
public.capa_workflow_idempotency.capa_case_id is
  'Stable CAPA aggregate identity affected by the bound workflow operation.';

comment on column
public.capa_workflow_idempotency.source_case_version_id is
  'Immutable case version reviewed as the authoritative source of the workflow operation.';

comment on column
public.capa_workflow_idempotency.resulting_case_version_id is
  'Immutable case version created by the bound workflow operation.';

comment on column
public.capa_workflow_idempotency.audit_event_id is
  'Immutable audit-event identity committed with the bound workflow operation.';

commit;
