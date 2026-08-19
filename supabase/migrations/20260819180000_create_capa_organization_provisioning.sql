begin;

-- ---------------------------------------------------------------------------
-- Controlled CAPA organization provisioning
-- ---------------------------------------------------------------------------
--
-- This private, server-only function provisions the initial organization,
-- active membership, CAPA owner authority, and organization-administrator
-- authority in one transaction.
--
-- Customer-specific identifiers are supplied operationally and are never
-- embedded in schema migrations.

create or replace function
private.capa_provision_organization_owner(
  p_organization_id uuid,
  p_user_id uuid,
  p_organization_name text,
  p_authorization_policy_version text,
  p_actor_id text
)
returns table (
  provisioned_organization_id uuid,
  provisioned_membership_id uuid,
  owner_role_assignment_id uuid,
  administrator_role_assignment_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_owner_assignment_ids uuid[];
  v_admin_assignment_ids uuid[];
  v_owner_assignment_id uuid;
  v_admin_assignment_id uuid;

  v_existing_organization_name text;
  v_existing_policy_version text;
  v_existing_organization_status text;

  v_existing_membership_status text;
  v_existing_membership_expires_at timestamptz;

  v_role_status text;
  v_role_human_authority boolean;
  v_role_permissions text[];

  v_now timestamptz :=
    statement_timestamp();
begin
  if p_organization_id is null then
    raise exception using
      errcode = '22023',
      message =
        'A CAPA organization identifier is required';
  end if;

  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message =
        'A Supabase user identifier is required';
  end if;

  if
    p_organization_name is null
    or btrim(p_organization_name)
      <> p_organization_name
    or char_length(p_organization_name)
      not between 1 and 200
  then
    raise exception using
      errcode = '22023',
      message =
        'The CAPA organization name is invalid';
  end if;

  if
    p_authorization_policy_version is null
    or btrim(p_authorization_policy_version)
      <> p_authorization_policy_version
    or char_length(
      p_authorization_policy_version
    ) not between 1 and 100
  then
    raise exception using
      errcode = '22023',
      message =
        'The CAPA authorization-policy version is invalid';
  end if;

  if
    p_actor_id is null
    or btrim(p_actor_id) <> p_actor_id
    or char_length(p_actor_id)
      not between 1 and 200
  then
    raise exception using
      errcode = '22023',
      message =
        'The provisioning actor identifier is invalid';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = p_user_id
  ) then
    raise exception using
      errcode = '22023',
      message =
        'The supplied Supabase user does not exist';
  end if;

  -- Validate the required controlled roles before writing anything.

  select
    status,
    human_authority,
    permissions
  into
    v_role_status,
    v_role_human_authority,
    v_role_permissions
  from public.capa_roles
  where role_id = 'CAPA_OWNER';

  if
    not found
    or v_role_status <> 'active'
    or not v_role_human_authority
    or not (
      'capa.case.create' =
      any(v_role_permissions)
    )
    or not (
      'capa.case.view' =
      any(v_role_permissions)
    )
  then
    raise exception using
      errcode = '55000',
      message =
        'The required CAPA_OWNER role configuration is invalid';
  end if;

  select
    status,
    human_authority,
    permissions
  into
    v_role_status,
    v_role_human_authority,
    v_role_permissions
  from public.capa_roles
  where role_id = 'CAPA_ORG_ADMIN';

  if
    not found
    or v_role_status <> 'active'
    or not v_role_human_authority
    or not (
      'capa.tenant.users.manage' =
      any(v_role_permissions)
    )
    or not (
      'capa.tenant.roles.manage' =
      any(v_role_permissions)
    )
  then
    raise exception using
      errcode = '55000',
      message =
        'The required CAPA_ORG_ADMIN role configuration is invalid';
  end if;

  -- Create the organization or verify an exact retry.

  select
    organization_name,
    authorization_policy_version,
    status
  into
    v_existing_organization_name,
    v_existing_policy_version,
    v_existing_organization_status
  from public.capa_organizations
  where organization_id =
    p_organization_id
  for update;

  if found then
    if
      v_existing_organization_name
        <> p_organization_name
      or v_existing_policy_version
        <> p_authorization_policy_version
      or v_existing_organization_status
        <> 'active'
    then
      raise exception using
        errcode = '55000',
        message =
          'The CAPA organization identifier conflicts with an existing organization';
    end if;
  else
    insert into public.capa_organizations (
      organization_id,
      organization_name,
      status,
      authorization_policy_version,
      sensitivity_class,
      effective_at,
      created_at,
      created_by_actor_type,
      created_by_actor_id,
      updated_at,
      updated_by_actor_type,
      updated_by_actor_id
    )
    values (
      p_organization_id,
      p_organization_name,
      'active',
      p_authorization_policy_version,
      'CUSTOMER_CONFIDENTIAL',
      v_now,
      v_now,
      'human',
      p_actor_id,
      v_now,
      'human',
      p_actor_id
    );
  end if;

  -- Create the membership or verify the existing active membership.

  select
    membership_id,
    status,
    expires_at
  into
    v_membership_id,
    v_existing_membership_status,
    v_existing_membership_expires_at
  from public.capa_organization_memberships
  where organization_id =
      p_organization_id
    and user_id = p_user_id
  for update;

  if found then
    if
      v_existing_membership_status
        <> 'active'
      or (
        v_existing_membership_expires_at
          is not null
        and v_existing_membership_expires_at
          <= v_now
      )
    then
      raise exception using
        errcode = '55000',
        message =
          'The existing CAPA membership is not active';
    end if;
  else
    v_membership_id :=
      gen_random_uuid();

    insert into
    public.capa_organization_memberships (
      membership_id,
      organization_id,
      user_id,
      status,
      effective_at,
      created_at,
      created_by_actor_type,
      created_by_actor_id,
      updated_at,
      updated_by_actor_type,
      updated_by_actor_id
    )
    values (
      v_membership_id,
      p_organization_id,
      p_user_id,
      'active',
      v_now,
      v_now,
      'human',
      p_actor_id,
      v_now,
      'human',
      p_actor_id
    );
  end if;

  -- Resolve or create CAPA_OWNER authority.

  select
    coalesce(
      array_agg(
        role_assignment_id
        order by role_assignment_id
      ),
      array[]::uuid[]
    )
  into v_owner_assignment_ids
  from public.capa_role_assignments
  where organization_id =
      p_organization_id
    and membership_id =
      v_membership_id
    and user_id = p_user_id
    and role_id = 'CAPA_OWNER'
    and scope_code = 'ORGANIZATION'
    and scope_resource_type is null
    and scope_resource_id is null
    and status = 'active'
    and effective_at <= v_now
    and (
      expires_at is null
      or expires_at > v_now
    );

  if cardinality(
    v_owner_assignment_ids
  ) > 1 then
    raise exception using
      errcode = '55000',
      message =
        'Multiple active CAPA_OWNER assignments were found';
  end if;

  if cardinality(
    v_owner_assignment_ids
  ) = 1 then
    v_owner_assignment_id :=
      v_owner_assignment_ids[1];
  else
    v_owner_assignment_id :=
      gen_random_uuid();

    insert into public.capa_role_assignments (
      role_assignment_id,
      organization_id,
      membership_id,
      user_id,
      role_id,
      scope_code,
      status,
      effective_at,
      granted_by_actor_type,
      granted_by_actor_id,
      grant_reason,
      created_at,
      updated_at
    )
    values (
      v_owner_assignment_id,
      p_organization_id,
      v_membership_id,
      p_user_id,
      'CAPA_OWNER',
      'ORGANIZATION',
      'active',
      v_now,
      'human',
      p_actor_id,
      'Initial controlled CAPA organization provisioning',
      v_now,
      v_now
    );
  end if;

  -- Resolve or create CAPA_ORG_ADMIN authority separately.

  select
    coalesce(
      array_agg(
        role_assignment_id
        order by role_assignment_id
      ),
      array[]::uuid[]
    )
  into v_admin_assignment_ids
  from public.capa_role_assignments
  where organization_id =
      p_organization_id
    and membership_id =
      v_membership_id
    and user_id = p_user_id
    and role_id =
      'CAPA_ORG_ADMIN'
    and scope_code = 'ORGANIZATION'
    and scope_resource_type is null
    and scope_resource_id is null
    and status = 'active'
    and effective_at <= v_now
    and (
      expires_at is null
      or expires_at > v_now
    );

  if cardinality(
    v_admin_assignment_ids
  ) > 1 then
    raise exception using
      errcode = '55000',
      message =
        'Multiple active CAPA_ORG_ADMIN assignments were found';
  end if;

  if cardinality(
    v_admin_assignment_ids
  ) = 1 then
    v_admin_assignment_id :=
      v_admin_assignment_ids[1];
  else
    v_admin_assignment_id :=
      gen_random_uuid();

    insert into public.capa_role_assignments (
      role_assignment_id,
      organization_id,
      membership_id,
      user_id,
      role_id,
      scope_code,
      status,
      effective_at,
      granted_by_actor_type,
      granted_by_actor_id,
      grant_reason,
      created_at,
      updated_at
    )
    values (
      v_admin_assignment_id,
      p_organization_id,
      v_membership_id,
      p_user_id,
      'CAPA_ORG_ADMIN',
      'ORGANIZATION',
      'active',
      v_now,
      'human',
      p_actor_id,
      'Initial controlled CAPA organization provisioning',
      v_now,
      v_now
    );
  end if;

  return query
  select
    p_organization_id,
    v_membership_id,
    v_owner_assignment_id,
    v_admin_assignment_id;
end;
$$;

revoke all on function
private.capa_provision_organization_owner(
  uuid,
  uuid,
  text,
  text,
  text
)
from public, anon, authenticated;

grant execute on function
private.capa_provision_organization_owner(
  uuid,
  uuid,
  text,
  text,
  text
)
to service_role;

comment on function
private.capa_provision_organization_owner(
  uuid,
  uuid,
  text,
  text,
  text
) is
  'Server-only, transaction-safe provisioning of one CAPA organization, active user membership, CAPA_OWNER authority, and separate CAPA_ORG_ADMIN authority. Exact retries reuse matching active records and conflicting state fails closed.';

commit;