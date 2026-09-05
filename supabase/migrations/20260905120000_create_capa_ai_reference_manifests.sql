begin;

create table public.capa_ai_reference_manifests (
  organization_id uuid not null,
  output_id uuid not null,
  run_id uuid not null,
  capa_case_id uuid not null,
  case_version_id uuid not null,
  record_version bigint not null,
  request_id uuid not null,
  correlation_id uuid not null,
  output_status text not null,
  manifest_schema_version text not null,
  fingerprint_algorithm text not null,
  reference_manifest jsonb not null,
  reference_manifest_sha256 text not null,
  created_at timestamptz not null default statement_timestamp(),

  constraint capa_ai_reference_manifests_pkey primary key (organization_id, output_id),
  constraint capa_ai_reference_manifests_run_unique unique (organization_id, run_id),
  constraint capa_ai_reference_manifests_record_version_positive check (record_version > 0),
  constraint capa_ai_reference_manifests_schema_version check (manifest_schema_version = 'capa-investigation-active-reference-manifest-1.0.0'),
  constraint capa_ai_reference_manifests_fingerprint_algorithm check (fingerprint_algorithm = 'sha256-canonical-json-v1'),
  constraint capa_ai_reference_manifests_document_object check (jsonb_typeof(reference_manifest) = 'object'),
  constraint capa_ai_reference_manifests_sha256 check (reference_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint capa_ai_reference_manifests_output_fk foreign key (
    organization_id, output_id, run_id, capa_case_id, case_version_id,
    record_version, request_id, correlation_id, output_status
  ) references public.capa_ai_outputs (
    organization_id, output_id, run_id, capa_case_id, case_version_id,
    record_version, request_id, correlation_id, status
  ) on update restrict on delete restrict
);

create trigger capa_ai_reference_manifests_reject_mutation
before update or delete on public.capa_ai_reference_manifests
for each row execute function private.capa_reject_immutable_mutation();

alter table public.capa_ai_reference_manifests enable row level security;
alter table public.capa_ai_reference_manifests force row level security;
revoke all on table public.capa_ai_reference_manifests from public, anon, authenticated, service_role;
grant select, insert on table public.capa_ai_reference_manifests to service_role;

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
    ) then
      raise exception using errcode = '23514', message = 'S40 AG-RCA AI output requires an exact durable reference manifest.';
    end if;
  end if;
  return new;
end;
$$;

create constraint trigger capa_ai_outputs_require_s40_reference_manifest
after insert on public.capa_ai_outputs deferrable initially deferred for each row
execute function private.capa_require_s40_reference_manifest();

comment on table public.capa_ai_reference_manifests is
  'Immutable server-only S40 reference provenance. Reference source IDs are never model prompt or AI output payload data.';

commit;
