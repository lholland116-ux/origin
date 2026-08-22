begin;

-- ---------------------------------------------------------------------------
-- Transactional CAPA creation idempotency
-- ---------------------------------------------------------------------------
--
-- One immutable row binds an organization-local idempotency key to the
-- normalized request fingerprint and the exact identities created for that
-- request. The row is inserted before case-number allocation in the same
-- transaction as the CAPA aggregate and audit event.
--
-- Deferred foreign keys allow that reservation-first ordering. If any
-- business or audit write fails, PostgreSQL rolls back the reservation,
-- allocated case number and every aggregate record together.

-- The audit table currently has a globally unique event_id. This additional
-- organization-qualified key allows the ledger foreign key to enforce the
-- tenant boundary as well as the event identity.
alter table public.capa_audit_events
  add constraint capa_audit_events_org_event_unique
  unique (organization_id, event_id);

create table public.capa_creation_idempotency (
  organization_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  capa_case_id uuid not null,
  case_version_id uuid not null,
  section_version_id uuid not null,
  audit_event_id uuid not null,
  created_at timestamptz not null
    default statement_timestamp(),

  primary key (
    organization_id,
    idempotency_key
  ),

  constraint capa_creation_idempotency_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (
      organization_id
    )
    on update restrict
    on delete restrict
    deferrable initially deferred,

  constraint capa_creation_idempotency_case_fk
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

  constraint capa_creation_idempotency_case_version_fk
    foreign key (
      organization_id,
      capa_case_id,
      case_version_id
    )
    references public.capa_case_versions (
      organization_id,
      capa_case_id,
      case_version_id
    )
    on update restrict
    on delete restrict
    deferrable initially deferred,

  constraint capa_creation_idempotency_section_version_fk
    foreign key (
      organization_id,
      capa_case_id,
      section_version_id
    )
    references public.capa_section_versions (
      organization_id,
      capa_case_id,
      section_version_id
    )
    on update restrict
    on delete restrict
    deferrable initially deferred,

  constraint capa_creation_idempotency_audit_event_fk
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

  constraint capa_creation_idempotency_key_format
    check (
      idempotency_key = btrim(idempotency_key)
      and char_length(idempotency_key)
        between 1 and 128
    ),

  constraint capa_creation_idempotency_fingerprint_format
    check (
      request_fingerprint ~ '^[0-9a-f]{64}$'
    )
);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------
--
-- A key-to-request binding must never be rewritten or removed. Reassignment
-- could otherwise cause an earlier client retry to resolve to a different
-- regulated record.

create trigger capa_creation_idempotency_reject_mutation
before update or delete
on public.capa_creation_idempotency
for each row
execute function private.capa_reject_immutable_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security and least privilege
-- ---------------------------------------------------------------------------
--
-- This table is an internal transaction-control ledger. Browser clients do
-- not receive direct read or write access. All access occurs through the
-- trusted server runtime using service_role credentials.

alter table public.capa_creation_idempotency
enable row level security;

alter table public.capa_creation_idempotency
force row level security;

revoke all
on table public.capa_creation_idempotency
from public, anon, authenticated, service_role;

grant select, insert
on table public.capa_creation_idempotency
to service_role;

-- ---------------------------------------------------------------------------
-- Controlled documentation
-- ---------------------------------------------------------------------------

comment on table public.capa_creation_idempotency is
  'Immutable server-only ledger binding an organization-local creation idempotency key and SHA-256 request fingerprint to one atomically created CAPA aggregate and audit event.';

comment on column
public.capa_creation_idempotency.organization_id is
  'Permanent tenant boundary within which the idempotency key is unique.';

comment on column
public.capa_creation_idempotency.idempotency_key is
  'Opaque client request key retained for safe exact retries; never interpreted as business data.';

comment on column
public.capa_creation_idempotency.request_fingerprint is
  'Lowercase hexadecimal SHA-256 digest of the canonical controlled creation request.';

comment on column
public.capa_creation_idempotency.capa_case_id is
  'Stable CAPA aggregate identity created by the bound request.';

comment on column
public.capa_creation_idempotency.case_version_id is
  'Initial immutable CAPA case-version identity created by the bound request.';

comment on column
public.capa_creation_idempotency.section_version_id is
  'Initial immutable intake section-version identity created by the bound request.';

comment on column
public.capa_creation_idempotency.audit_event_id is
  'Immutable case-created audit-event identity created by the bound request.';

commit;