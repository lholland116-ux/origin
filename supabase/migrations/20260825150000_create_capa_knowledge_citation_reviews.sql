begin;

create table public.capa_knowledge_citations (
  citation_id uuid primary key,
  organization_id uuid not null,
  claim_id uuid not null,
  source_id uuid not null,
  source_version_id uuid not null,
  passage_id uuid not null,
  retrieval_run_id uuid not null,
  citation_record jsonb not null,
  claim_text text not null,
  record_fingerprint_algorithm text not null default 'sha256',
  record_fingerprint text not null,
  recorded_at timestamptz not null,
  recorded_by_actor_type text not null,
  recorded_by_actor_id text not null,
  recorded_by_actor_version text,

  constraint capa_knowledge_citations_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_citations_source_fk
    foreign key (source_id)
    references public.capa_knowledge_sources (source_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_citations_version_fk
    foreign key (source_version_id)
    references public.capa_knowledge_source_versions (source_version_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_citations_passage_fk
    foreign key (passage_id)
    references public.capa_knowledge_passages (passage_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_citations_tenant_identity
    unique (organization_id, citation_id),
  constraint capa_knowledge_citations_content
    check (
      jsonb_typeof(citation_record) = 'object'
      and char_length(btrim(claim_text)) between 1 and 8000
      and record_fingerprint_algorithm = 'sha256'
      and record_fingerprint ~ '^[0-9a-f]{64}$'
      and recorded_by_actor_type in ('human', 'service', 'agent', 'system')
      and char_length(btrim(recorded_by_actor_id)) between 1 and 256
      and citation_record ->> 'citation_id' = citation_id::text
      and citation_record ->> 'claim_id' = claim_id::text
      and citation_record ->> 'source_id' = source_id::text
      and citation_record ->> 'source_version_id' = source_version_id::text
      and citation_record ->> 'passage_id' = passage_id::text
      and citation_record ->> 'retrieval_run_id' = retrieval_run_id::text
    )
);

create table public.capa_knowledge_citation_reviews (
  citation_review_id uuid primary key,
  organization_id uuid not null,
  citation_id uuid not null,
  claim_id uuid not null,
  source_id uuid not null,
  source_version_id uuid not null,
  passage_id uuid not null,
  retrieval_run_id uuid not null,
  review_record jsonb not null,
  record_fingerprint_algorithm text not null default 'sha256',
  record_fingerprint text not null,
  reviewed_at timestamptz not null,
  reviewed_by_actor_type text not null,
  reviewed_by_actor_id text not null,
  reviewed_by_actor_version text,

  constraint capa_knowledge_citation_reviews_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_citation_reviews_citation_fk
    foreign key (organization_id, citation_id)
    references public.capa_knowledge_citations (organization_id, citation_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_citation_reviews_content
    check (
      jsonb_typeof(review_record) = 'object'
      and record_fingerprint_algorithm = 'sha256'
      and record_fingerprint ~ '^[0-9a-f]{64}$'
      and reviewed_by_actor_type = 'human'
      and char_length(btrim(reviewed_by_actor_id)) between 1 and 256
      and review_record ->> 'citation_review_id' = citation_review_id::text
      and review_record ->> 'citation_id' = citation_id::text
      and review_record ->> 'claim_id' = claim_id::text
      and review_record ->> 'source_id' = source_id::text
      and review_record ->> 'source_version_id' = source_version_id::text
      and review_record ->> 'passage_id' = passage_id::text
      and review_record ->> 'retrieval_run_id' = retrieval_run_id::text
      and review_record ->> 'disposition' in (
        'valid', 'invalid', 'insufficient', 'wrong_source', 'wrong_version',
        'wrong_locator', 'not_applicable', 'needs_expert_review'
      )
    )
);

create index capa_knowledge_citations_source_idx
  on public.capa_knowledge_citations (
    organization_id, source_version_id, passage_id, recorded_at
  );

create index capa_knowledge_citation_reviews_citation_idx
  on public.capa_knowledge_citation_reviews (
    organization_id, citation_id, reviewed_at, citation_review_id
  );

create or replace function private.enforce_capa_knowledge_citation_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.capa_knowledge_sources source
    join public.capa_knowledge_source_versions version
      on version.source_id = source.source_id
    join public.capa_knowledge_passages passage
      on passage.source_version_id = version.source_version_id
    where source.source_id = new.source_id
      and version.source_version_id = new.source_version_id
      and passage.passage_id = new.passage_id
      and (
        (source.visibility = 'organization'
          and source.organization_id = new.organization_id
          and version.organization_id = new.organization_id
          and passage.organization_id = new.organization_id)
        or
        (source.visibility = 'approved_global'
          and source.organization_id is null
          and version.organization_id is null
          and passage.organization_id is null)
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'CAPA knowledge citation source scope is invalid.';
  end if;
  return new;
end
$$;

create trigger capa_knowledge_citations_scope_trigger
before insert on public.capa_knowledge_citations
for each row execute function private.enforce_capa_knowledge_citation_scope();

revoke all on function private.enforce_capa_knowledge_citation_scope()
from public, anon, authenticated, service_role;

alter table public.capa_knowledge_citations enable row level security;
alter table public.capa_knowledge_citations force row level security;
alter table public.capa_knowledge_citation_reviews enable row level security;
alter table public.capa_knowledge_citation_reviews force row level security;

revoke all on table public.capa_knowledge_citations
from public, anon, authenticated, service_role;
revoke all on table public.capa_knowledge_citation_reviews
from public, anon, authenticated, service_role;

grant select, insert on table public.capa_knowledge_citations to service_role;
grant select, insert on table public.capa_knowledge_citation_reviews to service_role;

comment on table public.capa_knowledge_citations is
  'Immutable tenant-bound validated citation snapshots with exact governed source provenance.';
comment on table public.capa_knowledge_citation_reviews is
  'Immutable attributable human citation-review disposition events.';

commit;
