begin;

do $$
declare
  affected_rows integer;
begin
  update public.capa_roles
  set
    permissions = case
      when permissions @> array['capa.ai.root_cause.review']::text[]
        then permissions
      else array_append(permissions, 'capa.ai.root_cause.review')
    end,
    role_version = case role_id
      when 'CAPA_REVIEWER' then '1.2.0'
      when 'CAPA_APPROVER' then '1.1.0'
      else role_version
    end
  where role_id in ('CAPA_REVIEWER', 'CAPA_APPROVER')
    and status = 'active'
    and human_authority = true;

  get diagnostics affected_rows = row_count;

  if affected_rows <> 2 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Expected active human CAPA reviewer and approver roles but updated %s',
        affected_rows
      );
  end if;
end;
$$;

do $$
declare
  reviewer_permissions text[];
  approver_permissions text[];
begin
  select permissions into reviewer_permissions
  from public.capa_roles
  where role_id = 'CAPA_REVIEWER' and status = 'active';

  select permissions into approver_permissions
  from public.capa_roles
  where role_id = 'CAPA_APPROVER' and status = 'active';

  if reviewer_permissions is null
    or not ('capa.ai.root_cause.review' = any(reviewer_permissions))
    or approver_permissions is null
    or not ('capa.ai.root_cause.review' = any(approver_permissions))
  then
    raise exception using
      errcode = 'P0001',
      message = 'S50 root-cause review advisory permission grant is invalid';
  end if;
end;
$$;

commit;
