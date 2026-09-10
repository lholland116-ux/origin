begin;

alter table public.capa_ai_reference_manifests
  drop constraint capa_ai_reference_manifests_schema_version;

alter table public.capa_ai_reference_manifests
  add constraint capa_ai_reference_manifests_schema_version
  check (
    manifest_schema_version in (
      'capa-investigation-active-reference-manifest-1.0.0',
      'capa-root-cause-review-reference-manifest-1.0.0',
      'capa-action-plan-advisory-reference-manifest-1.0.0',
      'capa-action-plan-review-advisory-reference-manifest-1.0.0',
      'capa-implementation-evidence-advisory-reference-manifest-1.0.0'
    )
  );

create or replace function private.capa_require_s80_implementation_evidence_manifest()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.agent_id = 'AG-IMPLEMENT'
    and new.agent_version = 'ag-implement-1.0.0'
    and new.output_schema_version = 'capa_implementation_evidence_advisory-1.0.0'
    and new.status = 'completed_draft'
  then
    if not exists (
      select 1
      from public.capa_ai_reference_manifests as manifest
      where manifest.organization_id = new.organization_id
        and manifest.output_id = new.output_id
        and manifest.run_id = new.run_id
        and manifest.capa_case_id = new.capa_case_id
        and manifest.case_version_id = new.case_version_id
        and manifest.record_version = new.record_version
        and manifest.request_id = new.request_id
        and manifest.correlation_id = new.correlation_id
        and manifest.output_status = new.status
        and manifest.manifest_schema_version = 'capa-implementation-evidence-advisory-reference-manifest-1.0.0'
    ) then
      raise exception using errcode = '23514', message = 'S80 AG-IMPLEMENT AI output requires an exact durable reference manifest.';
    end if;
  end if;
  return new;
end;
$$;

create constraint trigger capa_ai_outputs_require_s80_implementation_evidence_manifest
after insert on public.capa_ai_outputs
deferrable initially deferred
for each row
execute function private.capa_require_s80_implementation_evidence_manifest();

comment on table public.capa_ai_reference_manifests is
  'Immutable server-only S40, S50, S60, S70, and S80 reference provenance. Reference source IDs are never model prompt or AI output payload data.';

commit;
