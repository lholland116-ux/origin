begin;

create extension if not exists pgtap;

select plan(26);

select has_function(
  'public',
  'create_chat_message_with_images',
  array['uuid', 'text', 'jsonb', 'jsonb'],
  'atomic stored-image message RPC exists'
);

select ok(
  not (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.create_chat_message_with_images(uuid,text,jsonb,jsonb)'::regprocedure
  ),
  'stored-image message RPC uses SECURITY INVOKER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_chat_message_with_images(uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients can execute the stored-image message RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_chat_message_with_images(uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute the stored-image message RPC'
);

select ok(
  lower(pg_get_functiondef('public.create_chat_message_with_images(uuid,text,jsonb,jsonb)'::regprocedure))
    like '%auth.uid()%'
    and lower(pg_get_functiondef('public.create_chat_message_with_images(uuid,text,jsonb,jsonb)'::regprocedure))
      like '%profiles%'
    and lower(pg_get_functiondef('public.create_chat_message_with_images(uuid,text,jsonb,jsonb)'::regprocedure))
      like '%with ordinality%'
    and lower(pg_get_functiondef('public.create_chat_message_with_images(uuid,text,jsonb,jsonb)'::regprocedure))
      like '%storage_namespace%'
  ,
  'RPC derives identity, enforces plan, generates ordinals, and validates namespace'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.message_images'::regclass
  ),
  'message image RLS remains enabled'
);

-- Fixtures are created as the test owner; all RPC and RLS assertions below run
-- as an authenticated user with the corresponding JWT subject claim.
insert into auth.users (id, aud, role, email)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rpc-owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rpc-other@example.test');

insert into public.conversations (id, user_id, title)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Owner conversation'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Other conversation');

insert into public.messages (id, conversation_id, user_id, role, content, documents)
values (
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'user',
  'other user message',
  '[]'::jsonb
);

insert into public.message_images (message_id, storage_path, image_name, ordinal)
values (
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002/other.jpg',
  'other.jpg',
  1
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

set local role authenticated;

create temporary table rpc_message_ids on commit drop as
select public.create_chat_message_with_images(
  '20000000-0000-4000-8000-000000000001',
  'one stored image',
  '[]'::jsonb,
  '[{"storage_path":"10000000-0000-4000-8000-000000000001/one.jpg","image_name":"one.jpg"}]'::jsonb
) as id;

select is(
  (select count(*)::integer from rpc_message_ids),
  1,
  'RPC creates one parent message'
);

select is(
  (
    select count(*)::integer
    from public.message_images image
    join rpc_message_ids result on result.id = image.message_id
  ),
  1,
  'RPC creates every ordered image child'
);

select is(
  (
    select min(image.ordinal)::integer
    from public.message_images image
    join rpc_message_ids result on result.id = image.message_id
  ),
  1,
  'RPC generates one-based child ordinals in the database'
);

select throws_ok(
  $$select public.create_chat_message_with_images(
    '20000000-0000-4000-8000-000000000001',
    'free over limit',
    '[]'::jsonb,
    '[
      {"storage_path":"10000000-0000-4000-8000-000000000001/free-one.jpg","image_name":"free-one.jpg"},
      {"storage_path":"10000000-0000-4000-8000-000000000001/free-two.jpg","image_name":"free-two.jpg"}
    ]'::jsonb
  )$$,
  'P0001',
  'IMAGE_LIMIT_EXCEEDED',
  'Free users cannot persist more than one stored image'
);

select is(
  (select count(*)::integer from public.messages where content = 'free over limit'),
  0,
  'Free over-limit rejection creates no parent message'
);

update public.profiles
set plan = 'pro'
where id = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.create_chat_message_with_images(
    '20000000-0000-4000-8000-000000000001',
    'pro three images',
    '[]'::jsonb,
    '[
      {"storage_path":"10000000-0000-4000-8000-000000000001/pro-one.jpg","image_name":"pro-one.jpg"},
      {"storage_path":"10000000-0000-4000-8000-000000000001/pro-two.jpg","image_name":"pro-two.jpg"},
      {"storage_path":"10000000-0000-4000-8000-000000000001/pro-three.jpg","image_name":"pro-three.jpg"}
    ]'::jsonb
  )$$,
  'Pro users can persist up to three stored images'
);

select throws_ok(
  $$select public.create_chat_message_with_images(
    '20000000-0000-4000-8000-000000000001',
    'pro over limit',
    '[]'::jsonb,
    '[
      {"storage_path":"10000000-0000-4000-8000-000000000001/pro-four-one.jpg","image_name":"pro-four-one.jpg"},
      {"storage_path":"10000000-0000-4000-8000-000000000001/pro-four-two.jpg","image_name":"pro-four-two.jpg"},
      {"storage_path":"10000000-0000-4000-8000-000000000001/pro-four-three.jpg","image_name":"pro-four-three.jpg"},
      {"storage_path":"10000000-0000-4000-8000-000000000001/pro-four-four.jpg","image_name":"pro-four-four.jpg"}
    ]'::jsonb
  )$$,
  'P0001',
  'IMAGE_LIMIT_EXCEEDED',
  'Pro users cannot persist more than three stored images'
);

update public.profiles
set plan = 'unknown'
where id = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.create_chat_message_with_images(
    '20000000-0000-4000-8000-000000000001',
    'ambiguous plan',
    '[]'::jsonb,
    '[{"storage_path":"10000000-0000-4000-8000-000000000001/ambiguous.jpg","image_name":"ambiguous.jpg"}]'::jsonb
  )$$,
  'P0001',
  'PLAN_UNAVAILABLE',
  'Ambiguous plans fail closed for stored-image persistence'
);

update public.profiles
set plan = 'pro'
where id = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.create_chat_message_with_images(
    '20000000-0000-4000-8000-000000000001',
    'outside namespace',
    '[]'::jsonb,
    '[{"storage_path":"10000000-0000-4000-8000-000000000002/other.jpg","image_name":"other.jpg"}]'::jsonb
  )$$,
  'P0001',
  'INVALID_IMAGE',
  'RPC rejects storage paths outside the authenticated namespace'
);

select throws_ok(
  $$select public.create_chat_message_with_images(
    '20000000-0000-4000-8000-000000000002',
    'wrong conversation',
    '[]'::jsonb,
    '[{"storage_path":"10000000-0000-4000-8000-000000000001/wrong.jpg","image_name":"wrong.jpg"}]'::jsonb
  )$$,
  'P0001',
  'CONVERSATION_NOT_FOUND',
  'RPC enforces conversation ownership'
);

select throws_ok(
  $$select public.create_chat_message_with_images(
    '20000000-0000-4000-8000-000000000001',
    'base64 in metadata',
    '[]'::jsonb,
    '[{"storage_path":"10000000-0000-4000-8000-000000000001/base64.jpg","image_name":"base64.jpg","imageBase64":"data:image/jpeg;base64,not-allowed"}]'::jsonb
  )$$,
  'P0001',
  'INVALID_IMAGE',
  'RPC rejects base64 fields in stored-image metadata'
);

reset role;

create function pg_temp.reject_rpc_test_child()
returns trigger
language plpgsql
as $function$
begin
  if new.image_name = 'rollback.jpg' then
    raise exception 'TEST_CHILD_FAILURE';
  end if;

  return new;
end;
$function$;

create trigger reject_rpc_test_child
  before insert on public.message_images
  for each row
  execute function pg_temp.reject_rpc_test_child();

set local role authenticated;

select throws_ok(
  $$select public.create_chat_message_with_images(
    '20000000-0000-4000-8000-000000000001',
    'atomic rollback',
    '[]'::jsonb,
    '[{"storage_path":"10000000-0000-4000-8000-000000000001/rollback.jpg","image_name":"rollback.jpg"}]'::jsonb
  )$$,
  'P0001',
  'TEST_CHILD_FAILURE',
  'child failure aborts the atomic RPC'
);

select is(
  (select count(*)::integer from public.messages where content = 'atomic rollback'),
  0,
  'atomic child failure leaves no parent message'
);

select is(
  (select count(*)::integer from public.message_images where image_name = 'rollback.jpg'),
  0,
  'atomic child failure leaves no image child'
);

select is(
  (select count(*)::integer from public.message_images where message_id = '30000000-0000-4000-8000-000000000002'),
  0,
  'authenticated user cannot read another user message images'
);

reset role;

select is(
  (select count(*)::integer from public.message_images where message_id = '30000000-0000-4000-8000-000000000002'),
  1,
  'test owner can verify the protected other-user image remains present'
);

set local role authenticated;

delete from public.message_images
where message_id = '30000000-0000-4000-8000-000000000002';

reset role;

select is(
  (select count(*)::integer from public.message_images where message_id = '30000000-0000-4000-8000-000000000002'),
  1,
  'authenticated user cannot delete another user message images'
);

set local role authenticated;

update public.message_images
set image_name = 'unauthorized-update.jpg'
where message_id = '30000000-0000-4000-8000-000000000002';

reset role;

select is(
  (select image_name from public.message_images where message_id = '30000000-0000-4000-8000-000000000002'),
  'other.jpg',
  'authenticated user cannot update another user message images'
);

set local role authenticated;

delete from public.messages
where id = (select id from rpc_message_ids);

select is(
  (select count(*)::integer from public.message_images where message_id = (select id from rpc_message_ids)),
  0,
  'deleting a parent message cascades to its image children'
);

select ok(
  not has_table_privilege('anon', 'public.message_images', 'SELECT'),
  'anonymous clients cannot read normalized image rows'
);

select * from finish();

rollback;
