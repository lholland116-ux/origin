-- Milestone 5 operational activation: authorize governed citation review.
-- Citation disposition is a human-review activity and is therefore granted
-- only to the controlled CAPA_REVIEWER role.

update public.capa_roles
set
  permissions = case
    when 'capa.knowledge.citation.review' = any(permissions)
      then permissions
    else array_append(permissions, 'capa.knowledge.citation.review')
  end,
  role_version = '1.1.0'
where role_id = 'CAPA_REVIEWER'
  and status = 'active'
  and human_authority = true;

do $$
begin
  if not exists (
    select 1
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
      and status = 'active'
      and human_authority = true
      and 'capa.knowledge.citation.review' = any(permissions)
  ) then
    raise exception
      'Active human-authority CAPA_REVIEWER role was not granted citation-review permission';
  end if;
end;
$$;
