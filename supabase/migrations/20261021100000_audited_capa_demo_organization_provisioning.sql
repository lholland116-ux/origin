begin;

-- One-time, human-authenticated provisioning for the synthetic demonstration.
-- The original service-role-only primitive remains private. This fixed-purpose
-- wrapper derives the actor and the one organization/user scope from a signed,
-- server-managed Supabase app_metadata claim, then writes the immutable audit
-- event in the same transaction as organization provisioning.

create unique index capa_audit_events_single_demo_org_provisioning
  on public.capa_audit_events (event_type)
  where event_type = 'CAPA-ORGANIZATION-PROVISIONED';

create or replace function public.capa_provision_demonstration_organization()
returns table (
  provisioned_organization_id uuid,
  provisioned_membership_id uuid,
  owner_role_assignment_id uuid,
  administrator_role_assignment_id uuid,
  provisioning_audit_event_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := auth.jwt();
  v_scope jsonb;
  v_current_scope jsonb;
  v_actor_id uuid := auth.uid();
  v_organization_id uuid;
  v_target_user_id uuid;
  v_organization_name text;
  v_policy_version text;
  v_existing_event public.capa_audit_events%rowtype;
  v_existing_metadata jsonb;
  v_provisioned record;
  v_audit_event_id uuid;
  v_now timestamptz := statement_timestamp();
  v_target_is_synthetic boolean;
begin
  if v_actor_id is null
    or v_claims ->> 'role' is distinct from 'authenticated'
    or v_claims ->> 'aal' is distinct from 'aal2'
  then
    raise exception using
      errcode = '42501',
      message = 'A verified AAL2 provisioning operator session is required';
  end if;

  select raw_app_meta_data -> 'capa_demo_provisioning'
  into v_current_scope
  from auth.users
  where id = v_actor_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated provisioning operator is unavailable';
  end if;

  v_scope := v_claims -> 'app_metadata' -> 'capa_demo_provisioning';
  if jsonb_typeof(v_scope) <> 'object'
    or v_scope -> 'enabled' is distinct from 'true'::jsonb
    or v_scope is distinct from v_current_scope
  then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user is not an authorized demonstration provisioning operator';
  end if;

  if coalesce(v_scope ->> 'organization_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_scope ->> 'target_user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    raise exception using
      errcode = '22023',
      message = 'The signed demonstration provisioning scope is invalid';
  end if;

  v_organization_id := (v_scope ->> 'organization_id')::uuid;
  v_target_user_id := (v_scope ->> 'target_user_id')::uuid;
  v_organization_name := v_scope ->> 'organization_name';
  v_policy_version := v_scope ->> 'authorization_policy_version';

  if v_target_user_id = v_actor_id then
    raise exception using
      errcode = '42501',
      message = 'The operator and demonstration identity must be separate';
  end if;

  if v_organization_name is null
    or btrim(v_organization_name) <> v_organization_name
    or char_length(v_organization_name) not between 1 and 200
    or v_policy_version is null
    or btrim(v_policy_version) <> v_policy_version
    or char_length(v_policy_version) not between 1 and 100
  then
    raise exception using
      errcode = '22023',
      message = 'The signed demonstration provisioning details are invalid';
  end if;

  select coalesce(
    raw_app_meta_data -> 'lvtchat_synthetic_demo_identity' = 'true'::jsonb,
    false
  )
  into v_target_is_synthetic
  from auth.users
  where id = v_target_user_id;

  if not found or not v_target_is_synthetic then
    raise exception using
      errcode = '42501',
      message = 'The target Auth user is not designated as a synthetic demonstration identity';
  end if;

  -- This is a single-demonstration capability. Serialize all attempts before
  -- checking the immutable idempotency event or creating any records.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('capa-demo-organization-provisioning-v1', 0)
  );

  select *
  into v_existing_event
  from public.capa_audit_events
  where event_type = 'CAPA-ORGANIZATION-PROVISIONED'
    and idempotency_key = 'capa-demo-provision-v1'
  for update;

  if found then
    v_existing_metadata := v_existing_event.metadata;
    if v_existing_event.actor_id <> v_actor_id::text
      or v_existing_event.organization_id <> v_organization_id
      or v_existing_event.metadata ->> 'organization_name' <> v_organization_name
      or v_existing_event.metadata ->> 'authorization_policy_version' <> v_policy_version
      or v_existing_event.metadata ->> 'target_user_id' <> v_target_user_id::text
    then
      raise exception using
        errcode = '55000',
        message = 'A conflicting demonstration provisioning request already exists';
    end if;

    if not exists (
      select 1
      from public.capa_organizations as organization
      join public.capa_organization_memberships as membership
        on membership.organization_id = organization.organization_id
       and membership.membership_id = (v_existing_metadata ->> 'membership_id')::uuid
       and membership.user_id = v_target_user_id
      join public.capa_role_assignments as owner_assignment
        on owner_assignment.organization_id = organization.organization_id
       and owner_assignment.membership_id = membership.membership_id
       and owner_assignment.role_assignment_id = (v_existing_metadata ->> 'owner_role_assignment_id')::uuid
       and owner_assignment.user_id = v_target_user_id
       and owner_assignment.role_id = 'CAPA_OWNER'
       and owner_assignment.status = 'active'
       and owner_assignment.effective_at <= v_now
       and (owner_assignment.expires_at is null or owner_assignment.expires_at > v_now)
      join public.capa_role_assignments as admin_assignment
        on admin_assignment.organization_id = organization.organization_id
       and admin_assignment.membership_id = membership.membership_id
       and admin_assignment.role_assignment_id = (v_existing_metadata ->> 'administrator_role_assignment_id')::uuid
       and admin_assignment.user_id = v_target_user_id
       and admin_assignment.role_id = 'CAPA_ORG_ADMIN'
       and admin_assignment.status = 'active'
       and admin_assignment.effective_at <= v_now
       and (admin_assignment.expires_at is null or admin_assignment.expires_at > v_now)
      where organization.organization_id = v_organization_id
        and organization.organization_name = v_organization_name
        and organization.authorization_policy_version = v_policy_version
        and organization.status = 'active'
        and membership.status = 'active'
        and membership.effective_at <= v_now
        and (membership.expires_at is null or membership.expires_at > v_now)
    ) then
      raise exception using
        errcode = '55000',
        message = 'The previously provisioned demonstration state has changed';
    end if;

    return query
    select
      v_existing_event.organization_id,
      (v_existing_metadata ->> 'membership_id')::uuid,
      (v_existing_metadata ->> 'owner_role_assignment_id')::uuid,
      (v_existing_metadata ->> 'administrator_role_assignment_id')::uuid,
      v_existing_event.event_id;
    return;
  end if;

  if exists (
    select 1 from public.capa_audit_events
    where event_type = 'CAPA-ORGANIZATION-PROVISIONED'
  ) then
    raise exception using
      errcode = '55000',
      message = 'The single demonstration organization has already been provisioned';
  end if;

  if exists (
    select 1 from public.capa_organizations
    where organization_id = v_organization_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'The requested demonstration organization identifier is already in use';
  end if;

  if exists (
    select 1 from public.capa_organization_memberships
    where user_id = v_target_user_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'The synthetic demonstration identity already has an organization membership';
  end if;

  select *
  into v_provisioned
  from private.capa_provision_organization_owner(
    v_organization_id,
    v_target_user_id,
    v_organization_name,
    v_policy_version,
    v_actor_id::text
  );

  v_audit_event_id := pg_catalog.gen_random_uuid();
  v_existing_metadata := pg_catalog.jsonb_build_object(
    'organization_name', v_organization_name,
    'authorization_policy_version', v_policy_version,
    'target_user_id', v_target_user_id,
    'membership_id', v_provisioned.provisioned_membership_id,
    'owner_role_assignment_id', v_provisioned.owner_role_assignment_id,
    'administrator_role_assignment_id', v_provisioned.administrator_role_assignment_id
  );

  insert into public.capa_audit_events (
    event_id,
    organization_id,
    event_type,
    schema_version,
    aggregate_type,
    aggregate_id,
    aggregate_version,
    actor_type,
    actor_id,
    occurred_at,
    request_id,
    correlation_id,
    idempotency_key,
    action,
    target_object_type,
    target_object_id,
    outcome,
    after_object_type,
    after_object_id,
    configuration_versions,
    metadata
  ) values (
    v_audit_event_id,
    v_organization_id,
    'CAPA-ORGANIZATION-PROVISIONED',
    'capa-organization-provisioning-1.0.0',
    'CAPA-ORGANIZATION',
    v_organization_id::text,
    1,
    'human',
    v_actor_id::text,
    v_now,
    pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(),
    'capa-demo-provision-v1',
    'PROVISION-DEMONSTRATION-ORGANIZATION',
    'CAPA-ORGANIZATION',
    v_organization_id::text,
    'succeeded',
    'CAPA-ORGANIZATION',
    v_organization_id::text,
    pg_catalog.jsonb_build_object(
      'provisioning_contract', '1.0.0',
      'audit_schema', '1.0.0'
    ),
    v_existing_metadata
  );

  return query
  select
    v_provisioned.provisioned_organization_id,
    v_provisioned.provisioned_membership_id,
    v_provisioned.owner_role_assignment_id,
    v_provisioned.administrator_role_assignment_id,
    v_audit_event_id;
end;
$$;

-- Prevent the legacy privileged primitive from bypassing the audited wrapper.
revoke all on function private.capa_provision_organization_owner(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.capa_provision_demonstration_organization()
  from public, anon, service_role, authenticated;
grant execute on function public.capa_provision_demonstration_organization()
  to authenticated;

comment on function public.capa_provision_demonstration_organization() is
  'Fixed-purpose authenticated operator operation for one synthetic CAPA demonstration organization. Actor and scope derive from signed Supabase app_metadata; organization, membership, role assignments, and immutable audit event commit atomically.';

commit;
