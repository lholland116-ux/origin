begin;

select plan(5);

select is(
  (
    select status
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'active',
  'CAPA reviewer role is active'
);

select is(
  (
    select human_authority
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  true,
  'CAPA reviewer role requires human authority'
);

select is(
  (
    select role_version
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  '1.2.0',
  'CAPA reviewer role records the current controlled role version'
);

select ok(
  (
    select 'capa.knowledge.citation.review' = any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'CAPA reviewer role has citation-review permission'
);

select is(
  (
    select count(*)::integer
    from public.capa_roles
    where role_id <> 'CAPA_REVIEWER'
      and 'capa.knowledge.citation.review' = any(permissions)
  ),
  0,
  'citation-review permission is not granted to another seeded role'
);

select * from finish();
rollback;
