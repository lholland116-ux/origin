begin;

create extension if not exists pgtap;

select plan(25);

-- ---------------------------------------------------------------------------
-- Normalized attachment schema
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'message_images',
  'normalized message image attachment table exists'
);

select has_pk(
  'public',
  'message_images',
  'message image attachment table has a primary key'
);

select col_type_is(
  'public',
  'message_images',
  'message_id',
  'uuid',
  'message image attachment references a message UUID'
);

select col_type_is(
  'public',
  'message_images',
  'storage_path',
  'text',
  'message image attachment stores a storage path'
);

select col_type_is(
  'public',
  'message_images',
  'image_name',
  'text',
  'message image attachment stores the original image name'
);

select col_type_is(
  'public',
  'message_images',
  'ordinal',
  'integer',
  'message image attachment stores a stable ordering ordinal'
);

select col_has_default(
  'public',
  'message_images',
  'id',
  'message image attachment IDs have a database default'
);

select col_has_default(
  'public',
  'message_images',
  'created_at',
  'message image attachment creation time has a database default'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.message_images'::regclass
      and conname = 'message_images_message_id_fkey'
      and contype = 'f'
      and confrelid = 'public.messages'::regclass
  ),
  'message images belong to messages and cascade with their parent'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.message_images'::regclass
      and conname = 'message_images_message_id_ordinal_key'
      and contype = 'u'
  ),
  'each message image ordinal is unique within its message'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.message_images'::regclass
      and conname = 'message_images_ordinal_check'
      and contype = 'c'
  ),
  'message image ordinals are positive and one-based'
);

-- ---------------------------------------------------------------------------
-- Tenant isolation and least privilege
-- ---------------------------------------------------------------------------

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.message_images'::regclass
  ),
  'row-level security is enabled for message images'
);

select ok(
  not has_table_privilege('anon', 'public.message_images', 'SELECT'),
  'anonymous clients cannot read message images'
);

select ok(
  has_table_privilege('authenticated', 'public.message_images', 'SELECT'),
  'authenticated clients can read message images subject to RLS'
);

select ok(
  has_table_privilege('authenticated', 'public.message_images', 'INSERT'),
  'authenticated clients can insert message images subject to RLS'
);

select ok(
  has_table_privilege('service_role', 'public.message_images', 'SELECT'),
  'service role can read message images'
);

select ok(
  has_table_privilege('service_role', 'public.message_images', 'INSERT'),
  'service role can insert message images'
);

select ok(
  (
    select count(*) = 4
    from pg_catalog.pg_policy
    where polrelid = 'public.message_images'::regclass
  ),
  'message images expose separate select, insert, update, and delete policies'
);

select ok(
  (
    select bool_and(
      pg_get_expr(coalesce(polqual, polwithcheck), polrelid) ilike '%auth.uid()%'
      and pg_get_expr(coalesce(polqual, polwithcheck), polrelid) ilike '%messages%'
      and pg_get_expr(coalesce(polqual, polwithcheck), polrelid) ilike '%user_id%'
    )
    from pg_catalog.pg_policy
    where polrelid = 'public.message_images'::regclass
  ),
  'every message image policy derives ownership from the parent message user'
);

-- ---------------------------------------------------------------------------
-- Backward compatibility and ordering access path
-- ---------------------------------------------------------------------------

select has_column(
  'public',
  'messages',
  'image_path',
  'legacy singular message image path remains available'
);

select has_column(
  'public',
  'messages',
  'image_name',
  'legacy singular message image name remains available'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.message_images'::regclass
      and i.indisunique
      and a.attname = 'message_id'
  ),
  'message image lookups have a unique message_id-led ordering access path'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_description d
    where d.objoid = 'public.message_images'::regclass
      and d.description like '%legacy messages image columns remain supported%'
  ),
  'message image compatibility is documented on the table'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.messages'::regclass
      and attname = 'image_path'
      and attisdropped
  ),
  'legacy image path column was not dropped'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.messages'::regclass
      and attname = 'image_name'
      and attisdropped
  ),
  'legacy image name column was not dropped'
);

select * from finish();

rollback;
