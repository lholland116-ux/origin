begin;

select plan(12);

select has_table('public', 'capa_knowledge_citations');
select has_table('public', 'capa_knowledge_citation_reviews');
select has_pk('public', 'capa_knowledge_citations');
select has_pk('public', 'capa_knowledge_citation_reviews');
select has_fk('public', 'capa_knowledge_citations');
select has_fk('public', 'capa_knowledge_citation_reviews');
select col_is_pk('public', 'capa_knowledge_citations', 'citation_id');
select col_is_pk('public', 'capa_knowledge_citation_reviews', 'citation_review_id');
select table_privs_are(
  'public', 'capa_knowledge_citations', 'authenticated', array[]::text[]
);
select table_privs_are(
  'public', 'capa_knowledge_citation_reviews', 'authenticated', array[]::text[]
);
select policies_are('public', 'capa_knowledge_citations', array[]::text[]);
select policies_are('public', 'capa_knowledge_citation_reviews', array[]::text[]);

select * from finish();
rollback;
