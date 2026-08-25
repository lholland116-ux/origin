begin;

select plan(8);

select ok(
  (select permissions @> array['capa.ai.intake.advise']::text[]
   from public.capa_roles where role_id = 'CAPA_OWNER'),
  'CAPA owner can request intake advisory AI'
);

select ok(
  (select permissions @> array['capa.ai.intake.advise']::text[]
   from public.capa_roles where role_id = 'CAPA_CONTRIBUTOR'),
  'CAPA contributor can request intake advisory AI'
);

select ok(
  not (select permissions @> array['capa.ai.intake.advise']::text[]
       from public.capa_roles where role_id = 'CAPA_REVIEWER'),
  'CAPA reviewer does not gain intake drafting authority'
);

select ok(
  not (select permissions @> array['capa.ai.intake.advise']::text[]
       from public.capa_roles where role_id = 'CAPA_APPROVER'),
  'CAPA approver does not gain intake drafting authority'
);

select ok(
  not (select permissions @> array['capa.ai.intake.advise']::text[]
       from public.capa_roles where role_id = 'CAPA_AUDITOR'),
  'CAPA auditor remains read only'
);

select ok(
  not (select permissions @> array['capa.ai.intake.advise']::text[]
       from public.capa_roles where role_id = 'CAPA_ORG_ADMIN'),
  'organization administration alone grants no AI drafting authority'
);

select is(
  (select role_version from public.capa_roles where role_id = 'CAPA_OWNER'),
  '1.1.0',
  'CAPA owner permission set is versioned'
);

select is(
  (select role_version from public.capa_roles where role_id = 'CAPA_CONTRIBUTOR'),
  '1.1.0',
  'CAPA contributor permission set is versioned'
);

select * from finish();
rollback;
