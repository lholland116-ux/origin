begin;

do $$
declare
  affected_rows integer;
begin
  update public.capa_roles
  set
    permissions = case
      when permissions @> array['capa.ai.intake.advise']::text[]
        then permissions
      else array_append(permissions, 'capa.ai.intake.advise')
    end,
    role_version = case role_id
      when 'CAPA_OWNER' then '1.1.0'
      when 'CAPA_CONTRIBUTOR' then '1.1.0'
      else role_version
    end
  where role_id in ('CAPA_OWNER', 'CAPA_CONTRIBUTOR')
    and status = 'active'
    and human_authority = true;

  get diagnostics affected_rows = row_count;

  if affected_rows <> 2 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Expected two active human CAPA work roles but updated %s',
        affected_rows
      );
  end if;
end;
$$;

commit;
