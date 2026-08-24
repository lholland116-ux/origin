begin;

select plan(12);

select has_table(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'retrieval index table exists'
);

select has_column(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'organization_id',
  'retrieval index has explicit organization scope'
);

select has_column(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'approved_global',
  'retrieval index has explicit approved-global scope'
);

select has_column(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'collection_version_ids',
  'retrieval index binds exact collection versions'
);

select has_column(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'normalized_text_fingerprint',
  'retrieval index preserves derivative fingerprint provenance'
);

select has_column(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'lexical_search',
  'retrieval index has controlled lexical material'
);

select has_function(
  'private',
  'search_capa_knowledge_retrieval_index',
  'governed retrieval function exists'
);

select has_index(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'capa_knowledge_retrieval_index_lexical_gin',
  'retrieval lexical GIN index exists'
);

select has_pk(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'retrieval index has immutable material identity'
);

select table_privs_are(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'authenticated',
  array[]::text[],
  'authenticated clients have no direct retrieval index privileges'
);

select table_privs_are(
  'public',
  'capa_knowledge_retrieval_index_entries',
  'anon',
  array[]::text[],
  'anonymous clients have no direct retrieval index privileges'
);

select is(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.capa_knowledge_retrieval_index_entries'::regclass
  ),
  true,
  'retrieval index forces row-level security'
);

select * from finish();
rollback;
