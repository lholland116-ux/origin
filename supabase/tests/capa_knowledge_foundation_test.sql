begin;

create extension if not exists pgtap;

select plan(54);

-- ---------------------------------------------------------------------------
-- Required governed knowledge tables
-- ---------------------------------------------------------------------------

select has_table('public', 'capa_knowledge_sources',
  'knowledge source identity table exists');
select has_table('public', 'capa_knowledge_source_versions',
  'knowledge source-version table exists');
select has_table('public', 'capa_knowledge_original_artifacts',
  'knowledge original-artifact table exists');
select has_table('public', 'capa_knowledge_derivatives',
  'knowledge derivative table exists');
select has_table('public', 'capa_knowledge_passages',
  'knowledge passage table exists');
select has_table('public', 'capa_knowledge_collections',
  'knowledge collection identity table exists');
select has_table('public', 'capa_knowledge_collection_versions',
  'knowledge collection-version table exists');
select has_table('public', 'capa_knowledge_collection_version_sources',
  'knowledge collection membership table exists');

select has_pk('public', 'capa_knowledge_sources',
  'knowledge sources have a primary key');
select has_pk('public', 'capa_knowledge_source_versions',
  'knowledge source versions have a primary key');
select has_pk('public', 'capa_knowledge_original_artifacts',
  'knowledge original artifacts have a primary key');
select has_pk('public', 'capa_knowledge_derivatives',
  'knowledge derivatives have a primary key');
select has_pk('public', 'capa_knowledge_passages',
  'knowledge passages have a primary key');
select has_pk('public', 'capa_knowledge_collections',
  'knowledge collections have a primary key');
select has_pk('public', 'capa_knowledge_collection_versions',
  'knowledge collection versions have a primary key');
select has_pk('public', 'capa_knowledge_collection_version_sources',
  'knowledge collection membership has a primary key');

-- ---------------------------------------------------------------------------
-- Forced row-level security on every knowledge table
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid =
  'public.capa_knowledge_sources'::regclass),
  'knowledge sources enable RLS');
select ok((select relrowsecurity from pg_class where oid =
  'public.capa_knowledge_source_versions'::regclass),
  'knowledge source versions enable RLS');
select ok((select relrowsecurity from pg_class where oid =
  'public.capa_knowledge_original_artifacts'::regclass),
  'knowledge original artifacts enable RLS');
select ok((select relrowsecurity from pg_class where oid =
  'public.capa_knowledge_derivatives'::regclass),
  'knowledge derivatives enable RLS');
select ok((select relrowsecurity from pg_class where oid =
  'public.capa_knowledge_passages'::regclass),
  'knowledge passages enable RLS');
select ok((select relrowsecurity from pg_class where oid =
  'public.capa_knowledge_collections'::regclass),
  'knowledge collections enable RLS');
select ok((select relrowsecurity from pg_class where oid =
  'public.capa_knowledge_collection_versions'::regclass),
  'knowledge collection versions enable RLS');
select ok((select relrowsecurity from pg_class where oid =
  'public.capa_knowledge_collection_version_sources'::regclass),
  'knowledge membership enables RLS');

select ok((select relforcerowsecurity from pg_class where oid =
  'public.capa_knowledge_sources'::regclass),
  'knowledge sources force RLS');
select ok((select relforcerowsecurity from pg_class where oid =
  'public.capa_knowledge_source_versions'::regclass),
  'knowledge source versions force RLS');
select ok((select relforcerowsecurity from pg_class where oid =
  'public.capa_knowledge_original_artifacts'::regclass),
  'knowledge original artifacts force RLS');
select ok((select relforcerowsecurity from pg_class where oid =
  'public.capa_knowledge_derivatives'::regclass),
  'knowledge derivatives force RLS');
select ok((select relforcerowsecurity from pg_class where oid =
  'public.capa_knowledge_passages'::regclass),
  'knowledge passages force RLS');
select ok((select relforcerowsecurity from pg_class where oid =
  'public.capa_knowledge_collections'::regclass),
  'knowledge collections force RLS');
select ok((select relforcerowsecurity from pg_class where oid =
  'public.capa_knowledge_collection_versions'::regclass),
  'knowledge collection versions force RLS');
select ok((select relforcerowsecurity from pg_class where oid =
  'public.capa_knowledge_collection_version_sources'::regclass),
  'knowledge membership forces RLS');

-- ---------------------------------------------------------------------------
-- Immutability and cross-table scope controls
-- ---------------------------------------------------------------------------

select has_trigger('public', 'capa_knowledge_original_artifacts',
  'capa_knowledge_artifacts_reject_mutation',
  'original artifacts reject mutation');
select has_trigger('public', 'capa_knowledge_derivatives',
  'capa_knowledge_derivatives_reject_mutation',
  'derivatives reject mutation');
select has_trigger('public', 'capa_knowledge_passages',
  'capa_knowledge_passages_reject_mutation',
  'passages reject mutation');
select has_trigger('public', 'capa_knowledge_collection_versions',
  'capa_knowledge_collection_versions_reject_mutation',
  'collection versions reject mutation');
select has_trigger('public', 'capa_knowledge_collection_version_sources',
  'capa_knowledge_collection_sources_reject_mutation',
  'collection membership rejects mutation');

select has_trigger('public', 'capa_knowledge_source_versions',
  'capa_knowledge_source_versions_validate_scope',
  'source versions validate parent scope');
select has_trigger('public', 'capa_knowledge_original_artifacts',
  'capa_knowledge_artifacts_validate_scope',
  'original artifacts validate source scope');
select has_trigger('public', 'capa_knowledge_derivatives',
  'capa_knowledge_derivatives_validate_scope',
  'derivatives validate source scope');
select has_trigger('public', 'capa_knowledge_passages',
  'capa_knowledge_passages_validate_scope',
  'passages validate source scope');
select has_trigger('public', 'capa_knowledge_collection_versions',
  'capa_knowledge_collection_versions_validate_scope',
  'collection versions validate parent scope');
select has_trigger('public', 'capa_knowledge_collection_version_sources',
  'capa_knowledge_collection_sources_validate_scope',
  'collection membership validates both scopes');

select has_trigger('public', 'capa_knowledge_sources',
  'capa_knowledge_sources_validate_current_version',
  'current source pointer validates exact parent scope');
select has_trigger('public', 'capa_knowledge_collections',
  'capa_knowledge_collections_validate_current_version',
  'current collection pointer validates exact parent scope');
select has_trigger('public', 'capa_knowledge_sources',
  'capa_knowledge_sources_guard_update',
  'knowledge source identity updates are guarded');
select has_trigger('public', 'capa_knowledge_collections',
  'capa_knowledge_collections_guard_update',
  'knowledge collection identity updates are guarded');

select ok(
  to_regclass('public.capa_knowledge_source_versions_tenant_fingerprint_uidx')
    is not null,
  'tenant source fingerprints have a unique index');
select ok(
  to_regclass('public.capa_knowledge_source_versions_global_fingerprint_uidx')
    is not null,
  'approved-global source fingerprints have a unique index');

-- ---------------------------------------------------------------------------
-- Least privilege
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege(
  'anon', 'public.capa_knowledge_sources', 'SELECT'),
  'anonymous clients cannot read governed knowledge');
select ok(not has_table_privilege(
  'authenticated', 'public.capa_knowledge_passages', 'SELECT'),
  'authenticated browser clients cannot read passages directly');
select ok(has_table_privilege(
  'service_role', 'public.capa_knowledge_sources', 'INSERT'),
  'service role can register governed sources');
select ok(has_table_privilege(
  'service_role', 'public.capa_knowledge_source_versions', 'UPDATE'),
  'service role can execute guarded lifecycle updates');
select ok(not has_table_privilege(
  'service_role', 'public.capa_knowledge_sources', 'DELETE'),
  'service role cannot delete governed sources');

select * from finish();

rollback;
