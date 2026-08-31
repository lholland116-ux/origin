begin;
select plan(6);

select ok(
  (select 'capa.case.submit' = any(permissions) from public.capa_roles where role_id = 'CAPA_OWNER'),
  'CAPA_OWNER retains investigation-release permission'
);
select ok(
  (select 'capa.case.submit' = any(permissions) from public.capa_roles where role_id = 'CAPA_CONTRIBUTOR'),
  'CAPA_CONTRIBUTOR receives investigation-release permission'
);
select ok(
  not (select 'capa.case.submit' = any(permissions) from public.capa_roles where role_id = 'CAPA_REVIEWER'),
  'CAPA_REVIEWER does not receive investigation-release permission'
);
select ok(
  not (select 'capa.case.submit' = any(permissions) from public.capa_roles where role_id = 'CAPA_APPROVER'),
  'CAPA_APPROVER does not receive investigation-release permission'
);
select ok(
  not (select 'capa.gate.approve' = any(permissions) from public.capa_roles where role_id = 'CAPA_CONTRIBUTOR'),
  'CAPA_CONTRIBUTOR receives no approval authority'
);
select is(
  (select role_version from public.capa_roles where role_id = 'CAPA_CONTRIBUTOR'),
  '1.1.0',
  'CAPA_CONTRIBUTOR role version records the controlled grant'
);

select * from finish();
rollback;
