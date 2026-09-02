begin;

-- M6A CS4B pilot decision: the existing CAPA_CONTRIBUTOR role represents
-- an Investigator and may release an actionable S30 investigation plan by
-- using the existing capa.case.submit permission. No new role or approval
-- authority is introduced.
do $$
declare
  affected_rows integer;
begin
  update public.capa_roles
  set
    role_version = '1.1.0',
    permissions = case
      when permissions @> array['capa.case.submit']::text[]
        then permissions
      else array_append(permissions, 'capa.case.submit')
    end
  where role_id = 'CAPA_CONTRIBUTOR'
    and status = 'active'
    and human_authority = true
    and role_version = '1.1.0';

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'Expected exactly one unchanged active CAPA_CONTRIBUTOR role';
  end if;
end;
$$;

commit;
