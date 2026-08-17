begin;

-- ---------------------------------------------------------------------------
-- Refine baseline reviewer and approver authority
-- ---------------------------------------------------------------------------
--
-- Controlled sources:
--   LVT-CAPA-WFS-004, sections 4, 13 and Appendix A
--   WFR-002, WFR-007, WFS-AC-002 and WFS-AC-003
--
-- Controlled decisions:
--   W-TBD-001:
--     Reviewer-level gates use capa.review.disposition.
--     Approver-level gates use capa.gate.approve.
--
--   W-TBD-004:
--     Holding an administrative role does not grant review or approval
--     authority. Additional application-level segregation-of-duties rules
--     remain mandatory for consequential approvals.
--
-- This migration intentionally separates review disposition from final
-- gate approval. The original foundation role combined both permissions,
-- which would allow a baseline reviewer to close or reopen a CAPA.

do $$
declare
  affected_rows integer;
begin
  update public.capa_roles
  set
    role_name = 'CAPA Reviewer',
    role_version = '1.1.0',
    permissions = array[
      'capa.case.view',
      'capa.review.disposition'
    ]::text[],
    status = 'active',
    human_authority = true
  where role_id = 'CAPA_REVIEWER';

  get diagnostics affected_rows = row_count;

  if affected_rows <> 1 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Expected exactly one CAPA_REVIEWER role but updated %s',
        affected_rows
      );
  end if;
end;
$$;

insert into public.capa_roles (
  role_id,
  role_name,
  role_version,
  permissions,
  status,
  human_authority
)
values (
  'CAPA_APPROVER',
  'CAPA Approver or Quality Authority',
  '1.0.0',
  array[
    'capa.case.view',
    'capa.review.disposition',
    'capa.gate.approve'
  ]::text[],
  'active',
  true
)
on conflict (role_id) do update
set
  role_name = excluded.role_name,
  role_version = excluded.role_version,
  permissions = excluded.permissions,
  status = excluded.status,
  human_authority = excluded.human_authority;

-- Administrative authority remains separate from CAPA review,
-- disposition and approval authority.
do $$
declare
  affected_rows integer;
begin
  update public.capa_roles
  set
    role_version = '1.1.0',
    permissions = array[
      'capa.tenant.users.manage',
      'capa.tenant.roles.manage'
    ]::text[],
    status = 'active',
    human_authority = true
  where role_id = 'CAPA_ORG_ADMIN';

  get diagnostics affected_rows = row_count;

  if affected_rows <> 1 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Expected exactly one CAPA_ORG_ADMIN role but updated %s',
        affected_rows
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fail-closed migration verification
-- ---------------------------------------------------------------------------

do $$
declare
  reviewer_permissions text[];
  reviewer_human_authority boolean;
  approver_permissions text[];
  approver_human_authority boolean;
  administrator_permissions text[];
begin
  select
    permissions,
    human_authority
  into
    reviewer_permissions,
    reviewer_human_authority
  from public.capa_roles
  where role_id = 'CAPA_REVIEWER'
    and status = 'active';

  select
    permissions,
    human_authority
  into
    approver_permissions,
    approver_human_authority
  from public.capa_roles
  where role_id = 'CAPA_APPROVER'
    and status = 'active';

  select permissions
  into administrator_permissions
  from public.capa_roles
  where role_id = 'CAPA_ORG_ADMIN'
    and status = 'active';

  if reviewer_permissions is null
    or reviewer_human_authority is distinct from true
    or not (
      'capa.review.disposition' =
      any(reviewer_permissions)
    )
    or (
      'capa.gate.approve' =
      any(reviewer_permissions)
    )
  then
    raise exception using
      errcode = 'P0001',
      message =
        'CAPA_REVIEWER permission separation is invalid';
  end if;

  if approver_permissions is null
    or approver_human_authority is distinct from true
    or not (
      'capa.review.disposition' =
      any(approver_permissions)
    )
    or not (
      'capa.gate.approve' =
      any(approver_permissions)
    )
  then
    raise exception using
      errcode = 'P0001',
      message =
        'CAPA_APPROVER permissions are invalid';
  end if;

  if administrator_permissions is null
    or (
      'capa.review.disposition' =
      any(administrator_permissions)
    )
    or (
      'capa.gate.approve' =
      any(administrator_permissions)
    )
  then
    raise exception using
      errcode = 'P0001',
      message =
        'CAPA_ORG_ADMIN improperly grants review or approval authority';
  end if;
end;
$$;

comment on table public.capa_roles is
  'Controlled CAPA role templates and permission profiles. Reviewer and approver authority are separated according to LVT-CAPA-WFS-004.';

commit;