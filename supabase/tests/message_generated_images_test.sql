begin;

create extension if not exists pgtap;

select plan(55);

select has_table(
  'public',
  'message_generated_images',
  'durable generated-image metadata table exists'
);

select has_pk(
  'public',
  'message_generated_images',
  'generated-image metadata has a primary key'
);

select col_type_is('public', 'message_generated_images', 'message_id', 'uuid', 'generated metadata references a message UUID');
select col_type_is('public', 'message_generated_images', 'conversation_id', 'uuid', 'generated metadata stores conversation identity');
select col_type_is('public', 'message_generated_images', 'user_id', 'uuid', 'generated metadata stores tenant identity');
select col_type_is('public', 'message_generated_images', 'storage_path', 'text', 'generated metadata stores only a private storage path');
select col_type_is('public', 'message_generated_images', 'mime_type', 'text', 'generated metadata stores normalized MIME type');
select col_type_is('public', 'message_generated_images', 'provider', 'text', 'generated metadata stores provider provenance');
select col_type_is('public', 'message_generated_images', 'model', 'text', 'generated metadata stores model provenance');

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.message_generated_images'::regclass
      and conname = 'message_generated_images_message_id_fkey'
      and contype = 'f'
      and confrelid = 'public.messages'::regclass
      and pg_get_constraintdef(oid) ilike '%on delete cascade%'
  ),
  'generated metadata cascades when its assistant message is deleted'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.message_generated_images'::regclass
      and conname = 'message_generated_images_conversation_id_fkey'
      and contype = 'f'
      and confrelid = 'public.conversations'::regclass
      and pg_get_constraintdef(oid) ilike '%on delete cascade%'
  ),
  'generated metadata cascades when its conversation is deleted'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'message_generated_images'
      and indexdef ilike '%unique% (message_id)%'
  ),
  'message_id is not unique so a message can reference multiple generated images'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'message_generated_images'
      and indexname = 'message_generated_images_message_id_idx'
      and indexdef not ilike '%unique%'
      and indexdef ilike '%(message_id)%'
  ),
  'generated-image message lookup retains a non-unique index'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.message_generated_images'::regclass
      and conname = 'message_generated_images_storage_path_key'
      and contype = 'u'
  ),
  'generated storage paths cannot be overwritten by another metadata row'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.message_generated_images'::regclass
      and conname = 'message_generated_images_mime_type_check'
      and pg_get_constraintdef(oid) ilike '%image/webp%'
      and pg_get_constraintdef(oid) ilike '%image/png%'
      and pg_get_constraintdef(oid) ilike '%image/jpeg%'
  ),
  'generated MIME types are constrained to supported image formats'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.message_generated_images'::regclass),
  'generated metadata has row-level security enabled'
);

select ok(not has_table_privilege('anon', 'public.message_generated_images', 'SELECT'), 'anonymous clients cannot read generated metadata');
select ok(not has_table_privilege('anon', 'public.message_generated_images', 'INSERT'), 'anonymous clients cannot insert generated metadata');
select ok(has_table_privilege('authenticated', 'public.message_generated_images', 'SELECT'), 'authenticated clients can read generated metadata subject to RLS');

select ok(
  (
    select count(*) = 4
    from pg_catalog.pg_policy
    where polrelid = 'public.message_generated_images'::regclass
  ),
  'generated metadata has separate select, insert, update, and delete policies'
);

select ok(
  (
    select bool_and(
      pg_get_expr(coalesce(polqual, polwithcheck), polrelid) ilike '%auth.uid()%'
      and pg_get_expr(coalesce(polqual, polwithcheck), polrelid) ilike '%messages%'
      and pg_get_expr(coalesce(polqual, polwithcheck), polrelid) ilike '%conversation_id%'
    )
    from pg_catalog.pg_policy
    where polrelid = 'public.message_generated_images'::regclass
  ),
  'every generated metadata policy binds the row to auth and its parent message'
);

select has_function(
  'public',
  'delete_generated_image_metadata',
  array['uuid'],
  'owned image deletion RPC exists'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.delete_generated_image_metadata(uuid)'::regprocedure
  ),
  'image deletion RPC is SECURITY DEFINER with explicit owner filters'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.delete_generated_image_metadata(uuid)',
    'EXECUTE'
  ),
  'authenticated users can delete their own generated image metadata'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.delete_generated_image_metadata(uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot execute generated image deletion'
);

select has_function(
  'public',
  'create_generated_image_chat_exchange',
  array['uuid', 'text', 'text', 'text', 'text', 'text'],
  'atomic generated-image exchange RPC exists'
);

select ok(
  not (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.create_generated_image_chat_exchange(uuid,text,text,text,text,text)'::regprocedure
  ),
  'generated-image exchange RPC uses SECURITY INVOKER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_generated_image_chat_exchange(uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients can execute the generated-image exchange RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_generated_image_chat_exchange(uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute the generated-image exchange RPC'
);

select ok(
  lower(pg_get_functiondef('public.create_generated_image_chat_exchange(uuid,text,text,text,text,text)'::regprocedure))
    like '%auth.uid()%'
    and lower(pg_get_functiondef('public.create_generated_image_chat_exchange(uuid,text,text,text,text,text)'::regprocedure))
      like '%message_generated_images%'
    and lower(pg_get_functiondef('public.create_generated_image_chat_exchange(uuid,text,text,text,text,text)'::regprocedure))
      not like '%base64%'
    and lower(pg_get_functiondef('public.create_generated_image_chat_exchange(uuid,text,text,text,text,text)'::regprocedure))
      not like '%provider_url%',
  'RPC derives ownership and persists no provider URL or base64 data'
);

select has_column(
  'public',
  'messages',
  'image_path',
  'legacy singular image_path remains available'
);
select has_column(
  'public',
  'messages',
  'image_name',
  'legacy singular image_name remains available'
);

-- ---------------------------------------------------------------------------
-- Atomic exchange, ownership, rollback, and cascade behavior
-- ---------------------------------------------------------------------------

reset role;

insert into auth.users (id, aud, role, email)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'generated-owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'generated-other@example.test');

insert into public.conversations (id, user_id, title)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Generated owner conversation'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Generated other conversation');

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

set local role authenticated;

create temporary table generated_exchange on commit drop as
select *
from public.create_generated_image_chat_exchange(
  '20000000-0000-4000-8000-000000000001',
  'a durable generated prompt',
  'generated/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/one.webp',
  'image/webp',
  'replicate',
  'black-forest-labs/flux-schnell'
);

select is((select count(*)::integer from generated_exchange), 1, 'exchange RPC returns durable IDs');
select is((select count(*)::integer from public.messages where content = 'a durable generated prompt'), 1, 'exchange RPC persists the user prompt');
select is((select count(*)::integer from public.messages where role = 'assistant' and content = ''), 1, 'exchange RPC persists an empty assistant message');
select is((select count(*)::integer from public.message_generated_images where message_id = (select assistant_message_id from generated_exchange)), 1, 'generated metadata links to the assistant message');
select is((select provider from public.message_generated_images where storage_path like '%/one.webp'), 'replicate', 'provider metadata persists');
select is((select model from public.message_generated_images where storage_path like '%/one.webp'), 'black-forest-labs/flux-schnell', 'model metadata persists');

insert into public.message_generated_images (
  id,
  message_id,
  conversation_id,
  user_id,
  storage_path,
  mime_type,
  provider,
  model
)
values (
  '40000000-0000-4000-8000-000000000002',
  (select assistant_message_id from generated_exchange),
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'generated/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/two.png',
  'image/png',
  'runware',
  'runware:400@4'
);

reset role;
insert into public.image_edit_lineage (
  derivative_generated_image_id,
  operation,
  source_generated_image_id,
  instruction
)
values (
  '40000000-0000-4000-8000-000000000002',
  'edit',
  (select generated_image_id from generated_exchange),
  'Add a small blue detail.'
);

select is(
  (
    select source_generated_image_id
    from public.image_edit_lineage
    where derivative_generated_image_id = '40000000-0000-4000-8000-000000000002'
  ),
  (select generated_image_id from generated_exchange),
  'an edited image linked to the same message retains exact source lineage'
);

set local role authenticated;

select ok(
  (
    select count(*) = 2
      and count(distinct id) = 2
      and count(distinct message_id) = 1
    from public.message_generated_images
    where message_id = (select assistant_message_id from generated_exchange)
  ),
  'two independently identifiable images can link to the same assistant message'
);

select throws_ok(
  $$select public.create_generated_image_chat_exchange(
    '20000000-0000-4000-8000-000000000002',
    'wrong tenant prompt',
    'generated/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/wrong.webp',
    'image/webp',
    'replicate',
    'flux-schnell'
  )$$,
  'P0001',
  'CONVERSATION_NOT_FOUND',
  'exchange RPC enforces conversation ownership before persistence'
);

reset role;

create function pg_temp.reject_generated_metadata()
returns trigger
language plpgsql
as $function$
begin
  if new.provider = 'reject-test' then
    raise exception 'TEST_GENERATED_METADATA_FAILURE';
  end if;
  return new;
end;
$function$;

create trigger reject_generated_metadata_trigger
before insert on public.message_generated_images
for each row execute function pg_temp.reject_generated_metadata();

set local role authenticated;

select throws_ok(
  $$select public.create_generated_image_chat_exchange(
    '20000000-0000-4000-8000-000000000001',
    'rolled back generated prompt',
    'generated/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/rejected.webp',
    'image/webp',
    'reject-test',
    'flux-schnell'
  )$$,
  'P0001',
  'TEST_GENERATED_METADATA_FAILURE',
  'metadata failure rolls back both durable messages'
);

select is((select count(*)::integer from public.messages where content = 'rolled back generated prompt'), 0, 'failed exchange leaves no user message');
select is((select count(*)::integer from public.message_generated_images where storage_path like '%rejected.webp'), 0, 'failed exchange leaves no generated metadata');

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);

select is((select count(*)::integer from public.message_generated_images), 0, 'another authenticated user cannot read generated metadata');

select throws_ok(
  $$insert into public.message_generated_images (
      id, message_id, conversation_id, user_id, storage_path, mime_type, provider, model
    ) values (
      '40000000-0000-4000-8000-000000000003',
      (select assistant_message_id from generated_exchange),
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'generated/10000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000001/forbidden.webp',
      'image/webp',
      'replicate',
      'flux-schnell'
    )$$,
  '42501',
  NULL,
  'another authenticated user cannot attach an image to the owner message'
);

create temporary table denied_delete_attempt on commit drop as
select *
from public.delete_generated_image_metadata('40000000-0000-4000-8000-000000000002');

select is((select image_deleted from denied_delete_attempt), false, 'cross-user image deletion is reported as not found');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select is((select count(*)::integer from public.message_generated_images where message_id = (select assistant_message_id from generated_exchange)), 2, 'cross-user deletion leaves both owner image rows intact');

create temporary table deleted_sibling_image on commit drop as
select *
from public.delete_generated_image_metadata('40000000-0000-4000-8000-000000000002');

select is((select image_deleted from deleted_sibling_image), true, 'single-image deletion removes the requested metadata row');
select is((select message_deleted from deleted_sibling_image), false, 'assistant message remains while another generated image is linked');
select is((select count(*)::integer from public.message_generated_images where message_id = (select assistant_message_id from generated_exchange)), 1, 'deleting one image preserves its sibling metadata');

update public.messages
set sources = '[{"url":"https://example.test/source"}]'::jsonb,
    source_count = 1,
    widget = '{"type":"table"}'::jsonb
where id = (select assistant_message_id from generated_exchange);

create temporary table deleted_last_image_with_message_data on commit drop as
select *
from public.delete_generated_image_metadata((select generated_image_id from generated_exchange));

select is((select image_deleted from deleted_last_image_with_message_data), true, 'last image metadata can be deleted while preserving assistant data');
select is((select message_deleted from deleted_last_image_with_message_data), false, 'assistant message with sources, source count, or widget is preserved');
select is((select count(*)::integer from public.messages where id = (select assistant_message_id from generated_exchange)), 1, 'assistant message with non-image content remains after image deletion');

update public.messages
set sources = NULL,
    source_count = NULL,
    widget = NULL
where id = (select assistant_message_id from generated_exchange);

delete from public.messages
where id = (select assistant_message_id from generated_exchange);

select is((select count(*)::integer from public.message_generated_images where message_id = (select assistant_message_id from generated_exchange)), 0, 'deleting the assistant message cascades generated metadata');

select * from finish();

rollback;
