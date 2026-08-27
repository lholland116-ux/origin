begin;

-- ---------------------------------------------------------------------------
-- SRS-TBD-006 — CAPA AI intake advisory reviewer/approver role mapping
-- ---------------------------------------------------------------------------
--
-- Approved controlled decision:
--
-- 1. CAPA_REVIEWER receives capa.ai.intake.review.
-- 2. capa.ai.intake.review permits human ACCEPT / REJECT / REVISE disposition
--    of a governed CAPA AI intake advisory.
-- 3. AI advisory review is not CAPA approval, does not advance workflow, and
--    does not confer controlled-record mutation authority.
-- 4. CAPA_REVIEWER retains reviewer-level authority and must not receive
--    capa.gate.approve through this role.
-- 5. CAPA_APPROVER does not automatically receive capa.ai.intake.review.
-- 6. CAPA_OWNER, CAPA_CONTRIBUTOR, CAPA_AUDITOR and CAPA_ORG_ADMIN do not
--    receive capa.ai.intake.review by virtue of those roles.
-- 7. AI advisory review does not require NOT_CASE_OWNER because it is not an
--    approver-level CAPA gate decision.
-- 8. Existing NOT_CASE_OWNER segregation remains mandatory for consequential
--    approver-level CAPA gate decisions.
-- 9. A human may hold both reviewer and approver assignments; the authorities
--    remain distinct and AI advisory disposition never constitutes CAPA
--    approval.
--
-- This migration intentionally changes role configuration only. Existing
-- application authorization policy already treats review_ai_intake_advisory
-- as a separate human-only operation mapped to capa.ai.intake.review.

do $$
declare
  reviewer_role_version text;
  reviewer_permissions text[];
  reviewer_human_authority boolean;
begin
  select
    role_version,
    permissions,
    human_authority
  into
    reviewer_role_version,
    reviewer_permissions,
    reviewer_human_authority
  from public.capa_roles
  where role_id = 'CAPA_REVIEWER'
    and status = 'active';

  if reviewer_role_version is null then
    raise exception using
      errcode = 'P0001',
      message =
        'SRS-TBD-006 requires one active CAPA_REVIEWER role';
  end if;

  if reviewer_role_version <> '1.1.0' then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Unexpected CAPA_REVIEWER role version before SRS-TBD-006 resolution: %s',
        reviewer_role_version
      );
  end if;

  if reviewer_permissions is distinct from array[
    'capa.case.view',
    'capa.review.disposition',
    'capa.knowledge.citation.review'
  ]::text[] then
    raise exception using
      errcode = 'P0001',
      message =
        'Unexpected CAPA_REVIEWER permissions before SRS-TBD-006 resolution';
  end if;

  if reviewer_human_authority is distinct from true then
    raise exception using
      errcode = 'P0001',
      message =
        'CAPA_REVIEWER must retain human authority';
  end if;
end;
$$;

do $$
declare
  affected_rows integer;
begin
  update public.capa_roles
  set
    role_name = 'CAPA Reviewer',
    role_version = '1.2.0',
    permissions = array[
      'capa.case.view',
      'capa.review.disposition',
      'capa.knowledge.citation.review',
      'capa.ai.intake.review'
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

-- ---------------------------------------------------------------------------
-- Fail-closed post-migration verification
-- ---------------------------------------------------------------------------

do $$
declare
  controlled_role_count integer;
  ai_review_grant_count integer;
  unauthorized_other_grant_count integer;
  reviewer_role_version text;
  reviewer_permissions text[];
  reviewer_human_authority boolean;
begin
  select count(*)::integer
  into controlled_role_count
  from public.capa_roles
  where role_id in (
    'CAPA_OWNER',
    'CAPA_CONTRIBUTOR',
    'CAPA_REVIEWER',
    'CAPA_APPROVER',
    'CAPA_AUDITOR',
    'CAPA_ORG_ADMIN'
  );

  if controlled_role_count <> 6 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Expected six controlled CAPA roles but found %s',
        controlled_role_count
      );
  end if;

  select count(*)::integer
  into ai_review_grant_count
  from public.capa_roles
  where 'capa.ai.intake.review' = any(permissions);

  if ai_review_grant_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Expected exactly one capa.ai.intake.review role grant but found %s',
        ai_review_grant_count
      );
  end if;

  select count(*)::integer
  into unauthorized_other_grant_count
  from public.capa_roles
  where role_id <> 'CAPA_REVIEWER'
    and 'capa.ai.intake.review' = any(permissions);

  if unauthorized_other_grant_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Found %s unauthorized non-reviewer capa.ai.intake.review grant(s)',
        unauthorized_other_grant_count
      );
  end if;

  select
    role_version,
    permissions,
    human_authority
  into
    reviewer_role_version,
    reviewer_permissions,
    reviewer_human_authority
  from public.capa_roles
  where role_id = 'CAPA_REVIEWER'
    and status = 'active';

  if reviewer_role_version <> '1.2.0'
    or reviewer_human_authority is distinct from true
    or reviewer_permissions is distinct from array[
      'capa.case.view',
      'capa.review.disposition',
      'capa.knowledge.citation.review',
      'capa.ai.intake.review'
    ]::text[]
    or 'capa.gate.approve' = any(reviewer_permissions)
  then
    raise exception using
      errcode = 'P0001',
      message =
        'CAPA_REVIEWER SRS-TBD-006 role configuration is invalid';
  end if;
end;
$$;

commit;
