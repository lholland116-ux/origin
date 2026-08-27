begin;

select plan(13);

-- SRS-TBD-006 permanent authorization contract:
-- CAPA_REVIEWER alone receives governed AI intake-advisory review authority.
-- AI review remains distinct from CAPA gate approval authority.

select is(
  (
    select count(*)::integer
    from public.capa_roles
    where role_id in (
      'CAPA_OWNER',
      'CAPA_CONTRIBUTOR',
      'CAPA_REVIEWER',
      'CAPA_APPROVER',
      'CAPA_AUDITOR',
      'CAPA_ORG_ADMIN'
    )
  ),
  6,
  'all six controlled seeded CAPA roles exist'
);

select is(
  (
    select count(*)::integer
    from public.capa_roles
    where 'capa.ai.intake.review' = any(permissions)
  ),
  1,
  'exactly one CAPA role receives AI intake review authority'
);

select is(
  (
    select role_id
    from public.capa_roles
    where 'capa.ai.intake.review' = any(permissions)
  ),
  'CAPA_REVIEWER',
  'CAPA_REVIEWER is the sole AI intake advisory review role'
);

select is(
  (
    select role_version
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  '1.2.0',
  'CAPA_REVIEWER role version records the SRS-TBD-006 resolution'
);

select ok(
  (
    select human_authority
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'CAPA_REVIEWER retains human authority'
);

select is(
  (
    select permissions
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  array[
    'capa.case.view',
    'capa.review.disposition',
    'capa.knowledge.citation.review',
    'capa.ai.intake.review'
  ]::text[],
  'CAPA_REVIEWER has the exact approved SRS-TBD-006 permission profile'
);

select ok(
  not (
    select 'capa.gate.approve' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'CAPA_REVIEWER does not receive CAPA gate approval authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  'CAPA_APPROVER does not automatically receive AI intake review authority'
);

select ok(
  (
    select 'capa.gate.approve' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  'CAPA_APPROVER retains formal CAPA gate approval authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_OWNER'
  ),
  'CAPA owner does not implicitly gain AI intake review authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_CONTRIBUTOR'
  ),
  'CAPA contributor does not implicitly gain AI intake review authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_AUDITOR'
  ),
  'CAPA auditor does not gain AI intake review authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_ORG_ADMIN'
  ),
  'organization administration alone grants no AI intake review authority'
);

select * from finish();

rollback;
