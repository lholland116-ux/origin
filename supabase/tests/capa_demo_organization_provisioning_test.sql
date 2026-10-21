begin;

create extension if not exists pgtap;
select plan(43);

select ok(
  to_regprocedure('public.capa_provision_demonstration_organization()') is not null,
  'fixed-purpose demonstration provisioning RPC exists'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc
   where oid = to_regprocedure('public.capa_provision_demonstration_organization()')),
  'demonstration RPC is SECURITY DEFINER'
);
select ok(
  (select proconfig @> array['search_path=""']::text[] from pg_catalog.pg_proc
   where oid = to_regprocedure('public.capa_provision_demonstration_organization()')),
  'demonstration RPC has an empty search_path'
);
select is(
  (select pronargs from pg_catalog.pg_proc
   where oid = to_regprocedure('public.capa_provision_demonstration_organization()')),
  0::smallint,
  'actor, organization, and target identity are not caller parameters'
);
select ok(
  not has_function_privilege('anon', 'public.capa_provision_demonstration_organization()', 'EXECUTE'),
  'anonymous clients cannot invoke demonstration provisioning'
);
select ok(
  has_function_privilege('authenticated', 'public.capa_provision_demonstration_organization()', 'EXECUTE'),
  'authenticated role can reach the claim-gated RPC'
);
select ok(
  not has_function_privilege('service_role', 'public.capa_provision_demonstration_organization()', 'EXECUTE'),
  'service role has no direct grant to the operator RPC'
);
select ok(
  not has_function_privilege('service_role', 'private.capa_provision_organization_owner(uuid,uuid,text,text,text)', 'EXECUTE'),
  'service role cannot bypass the audited wrapper through the legacy primitive'
);
select ok(
  not has_function_privilege('authenticated', 'private.capa_provision_organization_owner(uuid,uuid,text,text,text)', 'EXECUTE'),
  'authenticated clients cannot invoke the legacy primitive'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.capa_audit_events'::regclass
      and tgname = 'capa_audit_events_reject_mutation'
      and not tgisinternal
  ),
  'provisioning audit uses the append-only CAPA audit table'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'operator@example.invalid', '',
    statement_timestamp(),
    '{"capa_demo_provisioning":{"enabled":true,"organization_id":"40000000-0000-4000-8000-000000000004","target_user_id":"50000000-0000-4000-8000-000000000005","organization_name":"Synthetic Demonstration Organization","authorization_policy_version":"policy-1.0.0"}}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '50000000-0000-4000-8000-000000000005',
    'authenticated', 'authenticated', 'demo-identity@example.invalid', '',
    statement_timestamp(),
    '{"lvtchat_synthetic_demo_identity":true}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '60000000-0000-4000-8000-000000000006',
    'authenticated', 'authenticated', 'unmarked-identity@example.invalid', '',
    statement_timestamp(), '{}'::jsonb, '{}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '70000000-0000-4000-8000-000000000007',
    'authenticated', 'authenticated', 'second-demo-identity@example.invalid', '',
    statement_timestamp(),
    '{"lvtchat_synthetic_demo_identity":true}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  );

-- PostgREST exposes the verified subject in a dedicated setting as well as
-- the claims JSON. Keep both synthetic settings bound to the same operator.
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","app_metadata":{}}',
  true
);
select throws_ok(
  $$select * from public.capa_provision_demonstration_organization()$$,
  '42501', null,
  'a signed-in user without the operator claim is denied'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1","app_metadata":{"capa_demo_provisioning":{"enabled":true,"organization_id":"40000000-0000-4000-8000-000000000004","target_user_id":"50000000-0000-4000-8000-000000000005","organization_name":"Synthetic Demonstration Organization","authorization_policy_version":"policy-1.0.0"}}}',
  true
);
select throws_ok(
  $$select * from public.capa_provision_demonstration_organization()$$,
  '42501', null,
  'operator session without AAL2 is denied'
);
select throws_ok(
  $$select * from public.capa_provision_demonstration_organization('50000000-0000-4000-8000-000000000005'::uuid)$$,
  '42883', null,
  'callers cannot supply an actor or target identity as an RPC argument'
);

-- The claim scope is signed in app_metadata and must still match the current
-- server-managed Auth record, so a stale token cannot survive revocation.
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","app_metadata":{"capa_demo_provisioning":{"enabled":true,"organization_id":"40000000-0000-4000-8000-000000000004","target_user_id":"60000000-0000-4000-8000-000000000006","organization_name":"Synthetic Demonstration Organization","authorization_policy_version":"policy-1.0.0"}}}',
  true
);
select throws_ok(
  $$select * from public.capa_provision_demonstration_organization()$$,
  '42501', null,
  'target without the server-managed synthetic identity marker is denied'
);
select is(
  (select count(*) from public.capa_organizations),
  0::bigint,
  'authorization failures create no organization'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","app_metadata":{"capa_demo_provisioning":{"enabled":true,"organization_id":"40000000-0000-4000-8000-000000000004","target_user_id":"50000000-0000-4000-8000-000000000005","organization_name":"Synthetic Demonstration Organization","authorization_policy_version":"policy-1.0.0"}}}',
  true
);
select ok(
  auth.uid() = '30000000-0000-4000-8000-000000000003'::uuid
    and auth.jwt() ->> 'sub' = auth.uid()::text
    and current_setting('request.jwt.claim.sub', true) = auth.uid()::text,
  'test operator identity agrees across both simulated subject settings'
);

create function public.test_reject_demo_provisioning_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type = 'CAPA-ORGANIZATION-PROVISIONED' then
    raise exception using errcode = 'P0001', message = 'TEST_AUDIT_INSERT_FAILURE';
  end if;
  return new;
end;
$$;
create trigger test_reject_demo_provisioning_audit
before insert on public.capa_audit_events
for each row execute function public.test_reject_demo_provisioning_audit();

select throws_ok(
  $$select * from public.capa_provision_demonstration_organization()$$,
  'P0001', 'TEST_AUDIT_INSERT_FAILURE',
  'audit failure aborts provisioning'
);
select is(
  (select count(*) from public.capa_organizations
   where organization_id = '40000000-0000-4000-8000-000000000004'),
  0::bigint,
  'audit failure rolls back organization creation'
);
select is(
  (select count(*) from public.capa_organization_memberships
   where organization_id = '40000000-0000-4000-8000-000000000004'),
  0::bigint,
  'audit failure rolls back membership creation'
);
select is(
  (select count(*) from public.capa_role_assignments
   where organization_id = '40000000-0000-4000-8000-000000000004'),
  0::bigint,
  'audit failure rolls back role assignments'
);
select is(
  (select count(*) from public.capa_audit_events
   where event_type = 'CAPA-ORGANIZATION-PROVISIONED'),
  0::bigint,
  'audit failure leaves no partial audit event'
);

drop trigger test_reject_demo_provisioning_audit on public.capa_audit_events;
drop function public.test_reject_demo_provisioning_audit();

create temporary table first_demo_provisioning_result as
select * from public.capa_provision_demonstration_organization();

select is(
  (select count(*) from public.capa_organizations
   where organization_id = '40000000-0000-4000-8000-000000000004'
     and status = 'active'
     and organization_name = 'Synthetic Demonstration Organization'),
  1::bigint,
  'the scoped synthetic organization is created once'
);
select is(
  (select count(*) from public.capa_organization_memberships
   where organization_id = '40000000-0000-4000-8000-000000000004'
     and user_id = '50000000-0000-4000-8000-000000000005'
     and status = 'active'),
  1::bigint,
  'one active synthetic user membership is created'
);
select is(
  (select count(*) from public.capa_role_assignments
   where organization_id = '40000000-0000-4000-8000-000000000004'
     and user_id = '50000000-0000-4000-8000-000000000005'
     and status = 'active'),
  2::bigint,
  'exactly two separate active role assignments are created'
);
select is(
  (select count(*) from public.capa_role_assignments
   where organization_id = '40000000-0000-4000-8000-000000000004'
     and user_id = '50000000-0000-4000-8000-000000000005'
     and role_id = 'CAPA_OWNER'
     and status = 'active'),
  1::bigint,
  'CAPA_OWNER is assigned for capa.case.create authority'
);
select is(
  (select count(*) from public.capa_role_assignments
   where organization_id = '40000000-0000-4000-8000-000000000004'
     and user_id = '50000000-0000-4000-8000-000000000005'
     and role_id = 'CAPA_ORG_ADMIN'
     and status = 'active'),
  1::bigint,
  'CAPA_ORG_ADMIN quality-data authority is assigned separately'
);
select isnt(
  (select owner_role_assignment_id from first_demo_provisioning_result),
  (select administrator_role_assignment_id from first_demo_provisioning_result),
  'CAPA owner and administrator have distinct assignment identities'
);
select ok(
  (select 'capa.case.create' = any(role.permissions)
   from public.capa_role_assignments as assignment
   join public.capa_roles as role using (role_id)
   where assignment.organization_id = '40000000-0000-4000-8000-000000000004'
     and assignment.user_id = '50000000-0000-4000-8000-000000000005'
     and assignment.role_id = 'CAPA_OWNER'
     and assignment.status = 'active'),
  'CAPA_OWNER retains case-creation authority'
);
select ok(
  not (select 'capa.case.create' = any(role.permissions)
   from public.capa_role_assignments as assignment
   join public.capa_roles as role using (role_id)
   where assignment.organization_id = '40000000-0000-4000-8000-000000000004'
     and assignment.user_id = '50000000-0000-4000-8000-000000000005'
     and assignment.role_id = 'CAPA_ORG_ADMIN'
     and assignment.status = 'active'),
  'CAPA_ORG_ADMIN does not gain CAPA case-creation authority'
);
select is(
  (select count(*) from public.capa_role_assignments
   where organization_id <> '40000000-0000-4000-8000-000000000004'),
  0::bigint,
  'provisioning changes no other organization role assignments'
);
select ok(
  exists (select 1 from public.capa_audit_events
   where event_id = (select provisioning_audit_event_id from first_demo_provisioning_result)
     and organization_id = '40000000-0000-4000-8000-000000000004'
     and actor_type = 'human'
     and actor_id = '30000000-0000-4000-8000-000000000003'
     and event_type = 'CAPA-ORGANIZATION-PROVISIONED'
     and outcome = 'succeeded'),
  'immutable audit actor is the authenticated operator, not request data'
);
select is(
  (select count(*) from public.capa_audit_events
   where event_type = 'CAPA-ORGANIZATION-PROVISIONED'),
  1::bigint,
  'one immutable audit event is recorded'
);
select is(
  (select idempotency_key from public.capa_audit_events
   where event_type = 'CAPA-ORGANIZATION-PROVISIONED'),
  'capa-demo-provision-v1'::text,
  'audit event carries the fixed provisioning idempotency key'
);

create temporary table replay_demo_provisioning_result as
select * from public.capa_provision_demonstration_organization();
select is(
  (select provisioned_organization_id from replay_demo_provisioning_result),
  (select provisioned_organization_id from first_demo_provisioning_result),
  'exact retry returns the original organization'
);
select is(
  (select provisioned_membership_id from replay_demo_provisioning_result),
  (select provisioned_membership_id from first_demo_provisioning_result),
  'exact retry returns the original membership'
);
select is(
  (select owner_role_assignment_id from replay_demo_provisioning_result),
  (select owner_role_assignment_id from first_demo_provisioning_result),
  'exact retry returns the original owner assignment'
);
select is(
  (select administrator_role_assignment_id from replay_demo_provisioning_result),
  (select administrator_role_assignment_id from first_demo_provisioning_result),
  'exact retry returns the original administrator assignment'
);
select is(
  (select provisioning_audit_event_id from replay_demo_provisioning_result),
  (select provisioning_audit_event_id from first_demo_provisioning_result),
  'exact retry returns the original audit event'
);
select is(
  (select count(*) from public.capa_audit_events
   where event_type = 'CAPA-ORGANIZATION-PROVISIONED'),
  1::bigint,
  'exact retry does not duplicate the audit event'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","app_metadata":{"capa_demo_provisioning":{"enabled":true,"organization_id":"40000000-0000-4000-8000-000000000004","target_user_id":"70000000-0000-4000-8000-000000000007","organization_name":"Synthetic Demonstration Organization","authorization_policy_version":"policy-1.0.0"}}}',
  true
);
update auth.users
set raw_app_meta_data = '{"capa_demo_provisioning":{"enabled":true,"organization_id":"40000000-0000-4000-8000-000000000004","target_user_id":"70000000-0000-4000-8000-000000000007","organization_name":"Synthetic Demonstration Organization","authorization_policy_version":"policy-1.0.0"}}'::jsonb
where id = '30000000-0000-4000-8000-000000000003';
select throws_ok(
  $$select * from public.capa_provision_demonstration_organization()$$,
  '55000', null,
  'changed target on an existing idempotency scope is rejected'
);
select is(
  (select count(*) from public.capa_organization_memberships
   where organization_id = '40000000-0000-4000-8000-000000000004'),
  1::bigint,
  'conflicting retry creates no second membership'
);
select is(
  (select count(*) from public.capa_role_assignments
   where organization_id = '40000000-0000-4000-8000-000000000004'),
  2::bigint,
  'conflicting retry creates no role assignments'
);

-- Restore server metadata but retain a stale, mismatched JWT claim.
update auth.users
set raw_app_meta_data = '{"capa_demo_provisioning":{"enabled":true,"organization_id":"40000000-0000-4000-8000-000000000004","target_user_id":"50000000-0000-4000-8000-000000000005","organization_name":"Synthetic Demonstration Organization","authorization_policy_version":"policy-1.0.0"}}'::jsonb
where id = '30000000-0000-4000-8000-000000000003';
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","app_metadata":{"capa_demo_provisioning":{"enabled":true,"organization_id":"40000000-0000-4000-8000-000000000004","target_user_id":"70000000-0000-4000-8000-000000000007","organization_name":"Synthetic Demonstration Organization","authorization_policy_version":"policy-1.0.0"}}}',
  true
);
select throws_ok(
  $$select * from public.capa_provision_demonstration_organization()$$,
  '42501', null,
  'stale operator scope fails closed against current Auth metadata'
);

select * from finish();
rollback;
