-- ---------------------------------------------------------------------------
-- LVTChat CAPA
-- M5 Closure Corrective Action CA-1
-- Require a durable generation trace for every future CAPA AI output.
--
-- Deployment sequencing:
--   1. capa_ai_generation_traces schema deployed
--   2. application dual-write deployed and production-validated
--   3. this migration enables fail-closed database enforcement
--
-- Historical capa_ai_outputs are intentionally not backfilled or rewritten.
-- This constraint trigger applies only to future output INSERT operations.
--
-- The trigger is DEFERRABLE INITIALLY DEFERRED so the application may insert
-- the immutable output first and its exact immutable generation trace second
-- inside the same database transaction.
-- ---------------------------------------------------------------------------

create or replace function private.capa_require_ai_generation_trace()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not exists (
    select 1
    from public.capa_ai_generation_traces as generation_trace
    where generation_trace.organization_id = new.organization_id
      and generation_trace.output_id = new.output_id
      and generation_trace.run_id = new.run_id
      and generation_trace.capa_case_id = new.capa_case_id
      and generation_trace.case_version_id = new.case_version_id
      and generation_trace.record_version = new.record_version
      and generation_trace.request_id = new.request_id
      and generation_trace.correlation_id = new.correlation_id
      and generation_trace.output_status = new.status
  ) then
    raise exception using
      errcode = '23514',
      message =
        'CAPA AI output requires an exact durable generation trace.';
  end if;

  return new;
end;
$$;

create constraint trigger capa_ai_outputs_require_generation_trace
after insert
on public.capa_ai_outputs
deferrable initially deferred
for each row
execute function private.capa_require_ai_generation_trace();

comment on function private.capa_require_ai_generation_trace()
is
  'CA-1 fail-closed control requiring every future CAPA AI output to have an exact durable generation trace before transaction commit.';

comment on trigger capa_ai_outputs_require_generation_trace
on public.capa_ai_outputs
is
  'CA-1 deferred constraint trigger requiring exact output/run/CAPA/request/correlation generation-trace provenance for every future CAPA AI output.';
