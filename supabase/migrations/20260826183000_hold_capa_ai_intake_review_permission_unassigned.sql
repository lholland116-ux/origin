begin;

-- M5G Change Set 6:
-- Governed human review of CAPA AI intake advisory output.
--
-- SRS-TBD-006 leaves final reviewer/approver role mapping unresolved.
-- Until that controlled decision is approved, no CAPA role may possess
-- capa.ai.intake.review.
--
-- Application policy recognizes the permission, but database role
-- configuration deliberately grants it to nobody.

do $$
declare
  unauthorized_grant_count integer;
begin
  select count(*)::integer
  into unauthorized_grant_count
  from public.capa_roles
  where 'capa.ai.intake.review' = any(permissions);

  if unauthorized_grant_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'capa.ai.intake.review must remain unassigned while SRS-TBD-006 is unresolved; found %s role grant(s)',
        unauthorized_grant_count
      );
  end if;
end;
$$;

commit;
