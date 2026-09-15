begin;

create extension if not exists pgtap;

select plan(76);

-- ---------------------------------------------------------------------------
-- Durable lineage schema and least privilege
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'image_edit_lineage',
  'image edit lineage table exists'
);

select has_pk(
  'public',
  'image_edit_lineage',
  'image edit lineage has a primary key'
);

select col_type_is('public', 'image_edit_lineage', 'derivative_generated_image_id', 'uuid', 'lineage stores the derivative generated-image identity');
select col_type_is('public', 'image_edit_lineage', 'operation', 'text', 'lineage stores the operation');
select col_type_is('public', 'image_edit_lineage', 'source_generated_image_id', 'uuid', 'lineage stores generated source identity');
select col_type_is('public', 'image_edit_lineage', 'source_uploaded_message_id', 'uuid', 'lineage stores uploaded source message identity');
select col_type_is('public', 'image_edit_lineage', 'source_uploaded_ordinal', 'integer', 'lineage stores uploaded source ordinal');
select col_type_is('public', 'image_edit_lineage', 'instruction', 'text', 'lineage stores the exact human instruction');
select col_type_is('public', 'image_edit_lineage', 'created_at', 'timestamp with time zone', 'lineage records creation time');

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_derivative_fkey'
      and contype = 'f'
      and confrelid = 'public.message_generated_images'::regclass
      and pg_get_constraintdef(oid) ilike '%on delete cascade%'
  ),
  'lineage derivative references generated-image metadata and cascades with it'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_source_generated_fkey'
      and contype = 'f'
      and confrelid = 'public.message_generated_images'::regclass
      and pg_get_constraintdef(oid) ilike '%deferrable%'
  ),
  'generated sources use a real deferred foreign key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_source_uploaded_fkey'
      and contype = 'f'
      and confrelid = 'public.message_images'::regclass
      and pg_get_constraintdef(oid) ilike '%deferrable%'
  ),
  'uploaded sources use the existing message-and-ordinal foreign key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_operation_check'
      and pg_get_constraintdef(oid) ilike '%edit%'
  ),
  'lineage operation is constrained to edit'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_source_check'
      and contype = 'c'
  ),
  'lineage requires exactly one valid source form'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_instruction_check'
      and contype = 'c'
  ),
  'lineage requires a bounded non-empty instruction'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_derivative_key'
      and contype = 'u'
  ),
  'each derivative can have only one direct lineage parent'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.image_edit_lineage'::regclass),
  'lineage has row-level security enabled'
);

select ok(not has_table_privilege('anon', 'public.image_edit_lineage', 'SELECT'), 'anonymous clients cannot read lineage');
select ok(has_table_privilege('authenticated', 'public.image_edit_lineage', 'SELECT'), 'authenticated clients can read authorized lineage');
select ok(not has_table_privilege('authenticated', 'public.image_edit_lineage', 'INSERT'), 'authenticated clients cannot insert lineage directly');
select ok(not has_table_privilege('authenticated', 'public.image_edit_lineage', 'UPDATE'), 'authenticated clients cannot rewrite lineage directly');
select ok(not has_table_privilege('authenticated', 'public.image_edit_lineage', 'DELETE'), 'authenticated clients cannot delete lineage directly');

select ok(
  (
    select count(*) = 1
    from pg_catalog.pg_policy
    where polrelid = 'public.image_edit_lineage'::regclass
      and polcmd = 'r'
  ),
  'lineage exposes only an authenticated read policy'
);

select has_function(
  'public',
  'complete_generated_image_edit',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'uuid', 'uuid', 'integer'],
  'atomic generated-image edit completion RPC exists'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.complete_generated_image_edit(uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure
  ),
  'edit completion RPC is security definer'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_generated_image_edit(uuid,uuid,text,text,text,text,text,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients can complete an edit through the RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.complete_generated_image_edit(uuid,uuid,text,text,text,text,text,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous clients cannot complete an edit through the RPC'
);

select ok(
  lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure))
    like '%image_generation_attempts%'
    and lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure))
      like '%image_edit_lineage%'
    and lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure))
      like '%message_images%',
  'edit completion validates the attempt and relational source identities'
);

select has_function(
  'public',
  'complete_generated_image_generation',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text'],
  'existing M8 generation completion RPC remains available'
);

-- Fixtures are created as the test owner. RPC and privilege assertions below
-- run as the authenticated owner represented by the JWT subject claim.
reset role;

insert into auth.users (id, aud, role, email)
values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'edit-owner@example.test'),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'edit-other@example.test');

insert into public.conversations (id, user_id, title)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Edit owner conversation'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'Edit other conversation');

insert into public.messages (id, conversation_id, user_id, role, content, documents)
values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'user', 'uploaded source message', '[]'::jsonb),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'assistant', '', '[]'::jsonb),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'assistant', '', '[]'::jsonb),
  ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'assistant', '', '[]'::jsonb);

insert into public.message_images (message_id, storage_path, image_name, ordinal)
values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001/source.png', 'source.png', 1);

insert into public.message_generated_images (
  id, message_id, conversation_id, user_id, storage_path, mime_type, provider, model
)
values
  ('94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/original.webp', 'image/webp', 'test-provider', 'test-model'),
  ('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/conflict.webp', 'image/webp', 'test-provider', 'test-model'),
  ('94000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'generated/91000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000002/other.webp', 'image/webp', 'test-provider', 'test-model');

insert into public.image_generation_attempts (
  id, user_id, conversation_id, plan_snapshot, status, reserved_at, expires_at,
  provider_started_at, provider, model, estimated_cost_microusd
)
values
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('95000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('95000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('95000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('95000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0),
  ('95000000-0000-4000-8000-000000000007', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'test-provider', 'test-model', 0);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
set local role authenticated;

create temporary table generated_edit on commit drop as
select *
from public.complete_generated_image_edit(
  '95000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '  Add a soft blue glow; preserve the subject.  ',
  'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/edit-one.webp',
  'image/webp',
  'test-provider',
  'test-model',
  '94000000-0000-4000-8000-000000000001',
  null::uuid,
  null::integer
);

select is((select count(*)::integer from generated_edit), 1, 'generated source edit completion returns durable IDs');
select is((select source_generated_image_id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)), '94000000-0000-4000-8000-000000000001'::uuid, 'generated source identity is persisted');
select is((select operation from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)), 'edit', 'edit operation is persisted');
select is((select instruction from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)), '  Add a soft blue glow; preserve the subject.  ', 'the exact human instruction is preserved');
select is((select content from public.messages where id = (select user_message_id from generated_edit)), '  Add a soft blue glow; preserve the subject.  ', 'the edit instruction is persisted as the user message');
select is((select status from public.image_generation_attempts where id = '95000000-0000-4000-8000-000000000001'), 'succeeded', 'successful edit completion consumes the existing attempt');
select is((select count(*)::integer from public.image_edit_lineage where source_generated_image_id = '94000000-0000-4000-8000-000000000001'), 1, 'one generated source can produce its first derivative');
select is((select count(*)::integer from public.image_edit_lineage where derivative_generated_image_id = '94000000-0000-4000-8000-000000000001'), 0, 'normal M8 generated images remain valid without lineage');
select is((select lineage_id from generated_edit), (select id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)), 'edit completion returns the durable lineage ID');

create temporary table uploaded_edit on commit drop as
select *
from public.complete_generated_image_edit(
  '95000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000001',
  'Remove the uploaded background.',
  'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/upload-edit.webp',
  'image/webp',
  'test-provider',
  'test-model',
  null::uuid,
  '93000000-0000-4000-8000-000000000001',
  1
);

select is((select count(*)::integer from uploaded_edit), 1, 'uploaded source edit completion returns durable IDs');
select is((select source_uploaded_message_id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from uploaded_edit)), '93000000-0000-4000-8000-000000000001'::uuid, 'uploaded source message identity is persisted');
select is((select source_uploaded_ordinal from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from uploaded_edit)), 1, 'uploaded source ordinal is persisted');
select is((select source_generated_image_id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from uploaded_edit)), null::uuid, 'uploaded lineage has no generated source field');
select is((select lineage_id from uploaded_edit), (select id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from uploaded_edit)), 'uploaded edit completion returns the durable lineage ID');

create temporary table chained_edit on commit drop as
select *
from public.complete_generated_image_edit(
  '95000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001',
  'Add soft rain to the edited image.',
  'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/edit-two.webp',
  'image/webp',
  'test-provider',
  'test-model',
  (select generated_image_id from generated_edit),
  null::uuid,
  null::integer
);

select is((select count(*)::integer from chained_edit), 1, 'an edit derivative can be used as the next generated source');
select is((select source_generated_image_id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from chained_edit)), (select generated_image_id from generated_edit), 'edit-to-edit lineage points to the prior derivative');

create temporary table branched_edit on commit drop as
select *
from public.complete_generated_image_edit(
  '95000000-0000-4000-8000-000000000004',
  '92000000-0000-4000-8000-000000000001',
  'Make a warm monochrome version.',
  'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/edit-branch.webp',
  'image/webp',
  'test-provider',
  'test-model',
  '94000000-0000-4000-8000-000000000001',
  null::uuid,
  null::integer
);

select is((select count(*)::integer from public.image_edit_lineage where source_generated_image_id = '94000000-0000-4000-8000-000000000001'), 2, 'one generated source can produce multiple derivatives');
select is((select count(*)::integer from public.image_edit_lineage where derivative_generated_image_id in ((select generated_image_id from generated_edit), (select generated_image_id from uploaded_edit), (select generated_image_id from chained_edit), (select generated_image_id from branched_edit))), 4, 'each successful derivative has one direct lineage record');
select is((select count(*)::integer from public.message_generated_images where id in ((select generated_image_id from generated_edit), (select generated_image_id from uploaded_edit), (select generated_image_id from chained_edit), (select generated_image_id from branched_edit))), 4, 'successful edit completion creates ordinary generated-image metadata rows');

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Replay the first edit.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/replay.webp',
    'image/webp', 'test-provider', 'test-model',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001',
  'IMAGE_ATTEMPT_NOT_RESERVED',
  'replaying a succeeded edit attempt cannot create another derivative'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000006',
    '92000000-0000-4000-8000-000000000001',
    'Use another user source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/wrong-source.webp',
    'image/webp', 'test-provider', 'test-model',
    '94000000-0000-4000-8000-000000000003', null::uuid, null::integer
  )$$,
  'P0001',
  'IMAGE_SOURCE_NOT_FOUND',
  'edit completion enforces source tenant and conversation ownership'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000005',
    '92000000-0000-4000-8000-000000000001',
    'This edit must roll back.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/conflict.webp',
    'image/webp', 'test-provider', 'test-model',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '23505',
  NULL::text,
  'a later metadata failure rolls back the complete edit transaction'
);

select is((select count(*)::integer from public.messages where content = 'This edit must roll back.'), 0, 'failed edit completion leaves no user message partial');
select is((select count(*)::integer from public.image_edit_lineage where instruction = 'This edit must roll back.'), 0, 'failed edit completion leaves no lineage partial');
select is((select status from public.image_generation_attempts where id = '95000000-0000-4000-8000-000000000005'), 'reserved', 'failed edit completion leaves the attempt available for controlled failure handling');

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Missing source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/missing-source.webp',
    'image/webp', 'test-provider', 'test-model',
    null::uuid, null::uuid, null::integer
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'source-less edit completion is rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Ambiguous source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/ambiguous.webp',
    'image/webp', 'test-provider', 'test-model',
    '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'an edit cannot claim generated and uploaded source classes together'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Generated source with ordinal.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/generated-with-ordinal.webp',
    'image/webp', 'test-provider', 'test-model',
    '94000000-0000-4000-8000-000000000001', null::uuid, 1
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'generated source cannot carry uploaded ordinal fields'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Uploaded source with generated identity.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/uploaded-with-generated.webp',
    'image/webp', 'test-provider', 'test-model',
    '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'uploaded source cannot carry generated identity'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Invalid ordinal.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/invalid-ordinal.webp',
    'image/webp', 'test-provider', 'test-model',
    null::uuid, '93000000-0000-4000-8000-000000000001', 0
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'uploaded source ordinals must be positive'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Missing generated source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/missing-generated.webp',
    'image/webp', 'test-provider', 'test-model',
    '94000000-0000-4000-8000-000000000099', null::uuid, null::integer
  )$$,
  'P0001',
  'IMAGE_SOURCE_NOT_FOUND',
  'nonexistent generated sources are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Missing uploaded source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/missing-uploaded.webp',
    'image/webp', 'test-provider', 'test-model',
    null::uuid, '93000000-0000-4000-8000-000000000099', 1
  )$$,
  'P0001',
  'IMAGE_SOURCE_NOT_FOUND',
  'nonexistent uploaded sources are rejected'
);

-- The following checks exercise database constraints directly as service_role;
-- ordinary authenticated clients do not receive this write privilege.
set local role service_role;
set constraints image_edit_lineage_source_generated_fkey, image_edit_lineage_source_uploaded_fkey immediate;

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, instruction)
    values ((select derivative_generated_image_id from public.image_edit_lineage where instruction = '  Add a soft blue glow; preserve the subject.  '), 'edit', '94000000-0000-4000-8000-000000000001', 'duplicate parent')$$,
  '23505',
  NULL::text,
  'a derivative cannot receive a second direct lineage parent'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', 'source-less')$$,
  '23514',
  NULL::text,
  'database rejects source-less lineage rows'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, source_uploaded_message_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1, 'ambiguous')$$,
  '23514',
  NULL::text,
  'database rejects ambiguous source lineage rows'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '94000000-0000-4000-8000-000000000001', 1, 'generated with ordinal')$$,
  '23514',
  NULL::text,
  'database rejects generated sources with uploaded fields'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, source_uploaded_message_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1, 'uploaded with generated identity')$$,
  '23514',
  NULL::text,
  'database rejects uploaded sources with generated fields'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_uploaded_message_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '93000000-0000-4000-8000-000000000001', 0, 'invalid ordinal')$$,
  '23514',
  NULL::text,
  'database rejects invalid uploaded ordinals'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, instruction)
    values ('94000000-0000-0000-0000-000000000099', 'edit', '94000000-0000-4000-8000-000000000001', 'missing derivative')$$,
  '23503',
  NULL::text,
  'database rejects a nonexistent derivative generated image'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '94000000-0000-4000-8000-000000000099', 'missing generated source')$$,
  '23503',
  NULL::text,
  'database rejects a nonexistent generated source'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_uploaded_message_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '93000000-0000-4000-8000-000000000099', 1, 'missing uploaded source')$$,
  '23503',
  NULL::text,
  'database rejects a nonexistent uploaded source relationship'
);

set local role authenticated;

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, instruction)
    values ((select generated_image_id from generated_edit), 'edit', '94000000-0000-4000-8000-000000000001', 'direct insert')$$,
  '42501',
  NULL::text,
  'ordinary authenticated clients cannot directly insert lineage'
);

select throws_ok(
  $$update public.image_edit_lineage set instruction = 'rewritten' where derivative_generated_image_id = (select generated_image_id from generated_edit)$$,
  '42501',
  NULL::text,
  'ordinary authenticated clients cannot rewrite lineage'
);

select throws_ok(
  $$delete from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)$$,
  '42501',
  NULL::text,
  'ordinary authenticated clients cannot independently delete lineage'
);

set local role service_role;

select throws_ok(
  $$delete from public.message_generated_images where id = '94000000-0000-4000-8000-000000000001'$$,
  '23503',
  NULL::text,
  'a generated source cannot be deleted while derivatives reference it'
);

set constraints image_edit_lineage_source_generated_fkey, image_edit_lineage_source_uploaded_fkey deferred;

reset role;

select lives_ok(
  $$delete from public.conversations where id = '92000000-0000-4000-8000-000000000001'$$,
  'deleting the complete conversation remains referentially safe'
);

select is((select count(*)::integer from public.image_edit_lineage), 0, 'conversation cleanup leaves no orphan lineage rows');

select * from finish();

rollback;
