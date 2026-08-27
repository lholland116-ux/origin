begin;

select plan(8);

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
  0,
  'AI intake review permission is granted to no CAPA role while SRS-TBD-006 remains unresolved'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_OWNER'
  ),
  'CAPA owner does not implicitly gain AI review authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_CONTRIBUTOR'
  ),
  'CAPA contributor does not implicitly gain AI review authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'CAPA reviewer is not granted AI review authority before reviewer-role mapping is approved'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  'CAPA approver does not implicitly gain AI review authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_AUDITOR'
  ),
  'CAPA auditor remains without AI review authority'
);

select ok(
  not (
    select 'capa.ai.intake.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_ORG_ADMIN'
  ),
  'organization administration alone grants no AI review authority'
);

select * from finish();

rollback;
