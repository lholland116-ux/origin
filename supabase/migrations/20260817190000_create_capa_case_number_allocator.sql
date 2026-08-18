begin;

-- ---------------------------------------------------------------------------
-- Organization-scoped CAPA case-number allocation
-- ---------------------------------------------------------------------------
--
-- Controlled format:
--   CAPA-000001 through CAPA-999999
--
-- Each organization owns an independent monotonically increasing counter.
-- Allocation must occur inside the same PostgreSQL transaction as CAPA case
-- creation. A failed transaction therefore rolls back both the aggregate
-- and its counter increment.
--
-- The existing unique constraint on public.capa_cases
-- (organization_id, case_number) remains the final uniqueness safeguard.

create table public.capa_case_number_counters (
  organization_id uuid primary key,

  last_allocated_number bigint not null,

  created_at timestamptz not null
    default statement_timestamp(),

  updated_at timestamptz not null
    default statement_timestamp(),

  constraint capa_case_number_counters_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (
      organization_id
    )
    on update restrict
    on delete restrict,

  constraint capa_case_number_counters_range
    check (
      last_allocated_number
      between 1 and 999999
    ),

  constraint capa_case_number_counters_times
    check (
      updated_at >= created_at
    )
);

-- ---------------------------------------------------------------------------
-- Counter-integrity enforcement
-- ---------------------------------------------------------------------------
--
-- A counter:
--   * must begin at one;
--   * can advance only by exactly one;
--   * cannot move backward or skip values;
--   * cannot be reassigned to another organization;
--   * cannot have its creation time rewritten;
--   * cannot move its update time backward; and
--   * cannot be deleted.
--
-- Prohibiting deletion prevents previously allocated numbers from being
-- reused after a counter row is removed and recreated.

create or replace function
private.capa_enforce_case_number_counter_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message =
        'A CAPA case-number counter cannot be deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.last_allocated_number <> 1 then
      raise exception using
        errcode = '55000',
        message =
          'A CAPA case-number counter must begin at one';
    end if;

    return new;
  end if;

  if new.organization_id
      <> old.organization_id
  then
    raise exception using
      errcode = '55000',
      message =
        'A CAPA case-number counter organization is immutable';
  end if;

  if new.created_at
      is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message =
        'A CAPA case-number counter creation time is immutable';
  end if;

  if new.last_allocated_number
      <> old.last_allocated_number + 1
  then
    raise exception using
      errcode = '55000',
      message =
        'A CAPA case-number counter must advance by exactly one';
  end if;

  if new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message =
        'A CAPA case-number counter update time cannot move backward';
  end if;

  return new;
end;
$$;

revoke all
on function
private.capa_enforce_case_number_counter_mutation()
from public;

create trigger
capa_case_number_counters_controlled_mutation
before insert or update or delete
on public.capa_case_number_counters
for each row
execute function
private.capa_enforce_case_number_counter_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security and least privilege
-- ---------------------------------------------------------------------------
--
-- Counter values are internal persistence controls. Browser clients must
-- not have direct visibility or mutation authority.
--
-- Explicitly revoking all service_role privileges before granting the
-- required subset prevents inherited default privileges from accidentally
-- granting DELETE, TRUNCATE, REFERENCES or TRIGGER authority.

alter table
public.capa_case_number_counters
enable row level security;

alter table
public.capa_case_number_counters
force row level security;

revoke all
on table public.capa_case_number_counters
from public, anon, authenticated, service_role;

grant select, insert, update
on table public.capa_case_number_counters
to service_role;

-- ---------------------------------------------------------------------------
-- Controlled documentation
-- ---------------------------------------------------------------------------

comment on table
public.capa_case_number_counters is
  'Internal organization-scoped allocator for CAPA-000001 through CAPA-999999. Allocation must occur in the same transaction as CAPA case creation. Counter rows cannot be deleted or reassigned.';

comment on column
public.capa_case_number_counters.organization_id is
  'Permanent organization boundary owning this independent CAPA case-number sequence.';

comment on column
public.capa_case_number_counters.last_allocated_number is
  'Most recent organization-local numeric CAPA identifier allocated transactionally.';

comment on function
private.capa_enforce_case_number_counter_mutation() is
  'Enforces initialization, monotonic advancement, immutability and non-deletion of organization-scoped CAPA case-number counters.';

commit;