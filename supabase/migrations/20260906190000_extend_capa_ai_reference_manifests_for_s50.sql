begin;

alter table public.capa_ai_reference_manifests
  drop constraint capa_ai_reference_manifests_schema_version;

alter table public.capa_ai_reference_manifests
  add constraint capa_ai_reference_manifests_schema_version
  check (
    manifest_schema_version in (
      'capa-investigation-active-reference-manifest-1.0.0',
      'capa-root-cause-review-reference-manifest-1.0.0'
    )
  );

create or replace function private.capa_require_s40_reference_manifest()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if new.agent_id = 'AG-RCA'
    and new.agent_version = 'ag-rca-1.0.0'
    and new.output_schema_version = 'capa_investigation_analysis_draft-1.0.0'
    and new.status = 'completed_draft'
  then
    if not exists (
      select 1 from public.capa_ai_reference_manifests as manifest
      where manifest.organization_id = new.organization_id
        and manifest.output_id = new.output_id
        and manifest.run_id = new.run_id
        and manifest.capa_case_id = new.capa_case_id
        and manifest.case_version_id = new.case_version_id
        and manifest.record_version = new.record_version
        and manifest.request_id = new.request_id
        and manifest.correlation_id = new.correlation_id
        and manifest.output_status = new.status
        and manifest.manifest_schema_version = 'capa-investigation-active-reference-manifest-1.0.0'
    ) then
      raise exception using errcode = '23514', message = 'S40 AG-RCA AI output requires an exact durable reference manifest.';
    end if;
  elsif new.agent_id = 'AG-REVIEW'
    and new.agent_version = 'ag-review-1.0.0'
    and new.output_schema_version = 'capa_review_packet_draft-1.0.0'
    and new.status = 'completed_draft'
  then
    if not exists (
      select 1 from public.capa_ai_reference_manifests as manifest
      where manifest.organization_id = new.organization_id
        and manifest.output_id = new.output_id
        and manifest.run_id = new.run_id
        and manifest.capa_case_id = new.capa_case_id
        and manifest.case_version_id = new.case_version_id
        and manifest.record_version = new.record_version
        and manifest.request_id = new.request_id
        and manifest.correlation_id = new.correlation_id
        and manifest.output_status = new.status
        and manifest.manifest_schema_version = 'capa-root-cause-review-reference-manifest-1.0.0'
    ) then
      raise exception using errcode = '23514', message = 'S50 AG-REVIEW AI output requires an exact durable reference manifest.';
    end if;
  end if;
  return new;
end;
$$;

comment on table public.capa_ai_reference_manifests is
  'Immutable server-only S40 and S50 reference provenance. Reference source IDs are never model prompt or AI output payload data.';

commit;
