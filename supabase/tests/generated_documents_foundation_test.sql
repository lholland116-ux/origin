begin;

create extension if not exists pgtap;

select plan(26);

select has_table('public', 'generated_documents', 'generated document metadata table exists');
select has_pk('public', 'generated_documents', 'generated document metadata has a primary key');
select col_type_is('public', 'generated_documents', 'user_id', 'uuid', 'metadata stores user UUID');
select col_type_is('public', 'generated_documents', 'conversation_id', 'uuid', 'metadata stores conversation UUID');
select col_type_is('public', 'generated_documents', 'message_id', 'uuid', 'metadata stores message UUID');
select col_type_is('public', 'generated_documents', 'generation_request_id', 'uuid', 'metadata stores request UUID');
select col_type_is('public', 'generated_documents', 'size_bytes', 'bigint', 'metadata stores byte size');

select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.generated_documents'::regclass), 'generated metadata has RLS enabled');
select ok(not has_table_privilege('anon', 'public.generated_documents', 'SELECT'), 'anon cannot read metadata');
select ok(not has_table_privilege('anon', 'public.generated_documents', 'INSERT'), 'anon cannot insert metadata');
select ok(not has_table_privilege('authenticated', 'public.generated_documents', 'SELECT'), 'authenticated clients cannot read directly');
select ok(not has_table_privilege('authenticated', 'public.generated_documents', 'INSERT'), 'authenticated clients cannot insert directly');
select ok(not has_table_privilege('authenticated', 'public.generated_documents', 'UPDATE'), 'authenticated clients cannot update directly');
select ok(not has_table_privilege('authenticated', 'public.generated_documents', 'DELETE'), 'authenticated clients cannot delete directly');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.generated_documents'::regclass
    and conname = 'generated_documents_generation_request_key'
), 'generation request identity is unique per user and conversation');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.generated_documents'::regclass
    and conname = 'generated_documents_format_check'
    and pg_get_constraintdef(oid) ilike '%pptx%'
    and pg_get_constraintdef(oid) ilike '%zip%'
), 'format values include PPTX and ZIP and reject others');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.generated_documents'::regclass
    and conname = 'generated_documents_mime_type_check'
    and pg_get_constraintdef(oid) ilike '%application/zip%'
    and pg_get_constraintdef(oid) ilike '%presentationml.presentation%'
), 'format and MIME mappings are constrained');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.generated_documents'::regclass
    and conname = 'generated_documents_size_bytes_check'
    and pg_get_constraintdef(oid) like '%10485760%'
), 'artifact size is limited to 10 MiB');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.generated_documents'::regclass
    and conname = 'generated_documents_storage_path_check'
    and pg_get_constraintdef(oid) ilike '%generated%'
), 'storage path is constrained to the generated namespace');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.generated_documents'::regclass
    and conname = 'generated_documents_user_id_fkey'
    and pg_get_constraintdef(oid) ilike '%on delete cascade%'
), 'user deletion cascades metadata');
select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.generated_documents'::regclass
    and conname = 'generated_documents_conversation_id_fkey'
    and pg_get_constraintdef(oid) ilike '%on delete cascade%'
), 'conversation deletion cascades metadata');
select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.generated_documents'::regclass
    and conname = 'generated_documents_message_id_fkey'
    and pg_get_constraintdef(oid) ilike '%on delete cascade%'
), 'message deletion cascades metadata');

select ok((select not public from storage.buckets where id = 'documents'), 'documents bucket remains private');
select ok((select file_size_limit = 10485760 from storage.buckets where id = 'documents'), 'documents bucket remains 10 MiB');
select ok((select allowed_mime_types @> array['application/vnd.openxmlformats-officedocument.presentationml.presentation']::text[] from storage.buckets where id = 'documents'), 'documents bucket permits PPTX');
select ok((select allowed_mime_types @> array['application/zip']::text[] from storage.buckets where id = 'documents'), 'documents bucket permits ZIP');

select * from finish();

rollback;
