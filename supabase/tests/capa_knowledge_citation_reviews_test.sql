begin;

select plan(12);

select has_table(
  'public',
  'capa_knowledge_citations',
  'CAPA knowledge citations table exists'
);

select has_table(
  'public',
  'capa_knowledge_citation_reviews',
  'CAPA knowledge citation reviews table exists'
);

select has_pk(
  'public',
  'capa_knowledge_citations',
  'CAPA knowledge citations table has a primary key'
);

select has_pk(
  'public',
  'capa_knowledge_citation_reviews',
  'CAPA knowledge citation reviews table has a primary key'
);

select has_fk(
  'public',
  'capa_knowledge_citations',
  'CAPA knowledge citations table has foreign-key controls'
);

select has_fk(
  'public',
  'capa_knowledge_citation_reviews',
  'CAPA knowledge citation reviews table has foreign-key controls'
);

select col_is_pk(
  'public',
  'capa_knowledge_citations',
  'citation_id',
  'citation_id is the citations primary-key column'
);

select col_is_pk(
  'public',
  'capa_knowledge_citation_reviews',
  'citation_review_id',
  'citation_review_id is the review primary-key column'
);

select table_privs_are(
  'public',
  'capa_knowledge_citations',
  'authenticated',
  array[]::text[]
);

select table_privs_are(
  'public',
  'capa_knowledge_citation_reviews',
  'authenticated',
  array[]::text[]
);

select policies_are(
  'public',
  'capa_knowledge_citations',
  array[]::text[]
);

select policies_are(
  'public',
  'capa_knowledge_citation_reviews',
  array[]::text[]
);

select * from finish();

rollback;
