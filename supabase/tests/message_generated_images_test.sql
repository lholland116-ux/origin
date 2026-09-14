begin;

create extension if not exists pgtap;

select plan(39);

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
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.message_generated_images'::regclass
      and conname = 'message_generated_images_message_id_key'
      and contype = 'u'
  ),
  'one generated image metadata record is linked to each assistant message'
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
select is((select provider from public.message_generated_images where message_id = (select assistant_message_id from generated_exchange)), 'replicate', 'provider metadata persists');
select is((select model from public.message_generated_images where message_id = (select assistant_message_id from generated_exchange)), 'black-forest-labs/flux-schnell', 'model metadata persists');

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

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

delete from public.messages
where id = (select assistant_message_id from generated_exchange);

select is((select count(*)::integer from public.message_generated_images where message_id = (select assistant_message_id from generated_exchange)), 0, 'deleting the assistant message cascades generated metadata');

select * from finish();

rollback;
