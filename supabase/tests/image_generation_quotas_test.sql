begin;

create extension if not exists pgtap;

select plan(68);

select has_table(
  'public',
  'image_generation_attempts',
  'image-generation attempt ledger exists'
);

select has_pk(
  'public',
  'image_generation_attempts',
  'image-generation attempt ledger has a primary key'
);

select col_type_is(
  'public',
  'image_generation_attempts',
  'user_id',
  'uuid',
  'attempts store tenant identity as UUID'
);

select col_type_is(
  'public',
  'image_generation_attempts',
  'estimated_cost_microusd',
  'bigint',
  'estimated operational cost uses integer micro-USD'
);

select col_has_default(
  'public',
  'image_generation_attempts',
  'status',
  'attempts default to reserved'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.image_generation_attempts'::regclass
  ),
  'attempt ledger has row-level security enabled'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_generation_attempts'::regclass
      and conname = 'image_generation_attempts_status_check'
      and pg_get_constraintdef(oid) ilike '%reserved%'
      and pg_get_constraintdef(oid) ilike '%succeeded%'
      and pg_get_constraintdef(oid) ilike '%released%'
  ),
  'attempt status is constrained to the lifecycle states'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_generation_attempts'::regclass
      and conname = 'image_generation_attempts_plan_check'
      and pg_get_constraintdef(oid) ilike '%free%'
      and pg_get_constraintdef(oid) ilike '%pro%'
  ),
  'attempt plan snapshots are constrained to supported plans'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_generation_attempts'::regclass
      and conname = 'image_generation_attempts_cost_check'
  ),
  'estimated cost is constrained to nonnegative values'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_generation_attempts'::regclass
      and conname = 'image_generation_attempts_lifecycle_check'
  ),
  'attempt lifecycle timestamps are constrained by status'
);

select ok(
  not has_table_privilege('anon', 'public.image_generation_attempts', 'SELECT'),
  'anonymous clients cannot read image-generation attempts'
);

select ok(
  not has_table_privilege('anon', 'public.image_generation_attempts', 'INSERT'),
  'anonymous clients cannot insert image-generation attempts'
);

select ok(
  has_table_privilege('authenticated', 'public.image_generation_attempts', 'SELECT'),
  'authenticated clients may read attempts subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.image_generation_attempts', 'INSERT'),
  'authenticated clients cannot insert attempts directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.image_generation_attempts', 'UPDATE'),
  'authenticated clients cannot update attempts directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.image_generation_attempts', 'DELETE'),
  'authenticated clients cannot delete attempts directly'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policy
    where polrelid = 'public.image_generation_attempts'::regclass
      and polcmd = 'r'
      and pg_get_expr(polqual, polrelid) ilike '%auth.uid()%'
  ),
  'attempt reads are tenant-scoped by auth.uid'
);

select has_function(
  'public',
  'reserve_image_generation_quota',
  array['uuid'],
  'quota reservation RPC exists'
);

select has_function(
  'public',
  'start_image_generation_attempt',
  array['uuid', 'text', 'text'],
  'provider-start telemetry RPC exists'
);

select has_function(
  'public',
  'release_image_generation_quota',
  array['uuid', 'text'],
  'quota release RPC exists'
);

select has_function(
  'public',
  'complete_generated_image_generation',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text'],
  'atomic generated-image completion RPC exists'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.reserve_image_generation_quota(uuid)'::regprocedure
  ),
  'reservation RPC is security definer'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.start_image_generation_attempt(uuid,text,text)'::regprocedure
  ),
  'provider-start RPC is security definer'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.release_image_generation_quota(uuid,text)'::regprocedure
  ),
  'release RPC is security definer'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.complete_generated_image_generation(uuid,uuid,text,text,text,text,text)'::regprocedure
  ),
  'completion RPC is security definer'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.reserve_image_generation_quota(uuid)',
    'EXECUTE'
  ),
  'authenticated clients can reserve through the RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.reserve_image_generation_quota(uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot reserve through the RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.start_image_generation_attempt(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated clients can mark provider start through the RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.release_image_generation_quota(uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients can release through the RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_generated_image_generation(uuid,uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients can complete through the RPC'
);

select ok(
  lower(pg_get_functiondef('public.reserve_image_generation_quota(uuid)'::regprocedure))
    like '%pg_advisory_xact_lock%'
    and lower(pg_get_functiondef('public.reserve_image_generation_quota(uuid)'::regprocedure))
      like '%at time zone ''utc''%'
    and lower(pg_get_functiondef('public.reserve_image_generation_quota(uuid)'::regprocedure))
      like '%expires_at%'
  ,
  'reservation RPC serializes per-user UTC active-capacity checks'
);

select ok(
  lower(pg_get_functiondef('public.complete_generated_image_generation(uuid,uuid,text,text,text,text,text)'::regprocedure))
    like '%image_generation_attempts%'
    and lower(pg_get_functiondef('public.complete_generated_image_generation(uuid,uuid,text,text,text,text,text)'::regprocedure))
      like '%message_generated_images%'
    and lower(pg_get_functiondef('public.complete_generated_image_generation(uuid,uuid,text,text,text,text,text)'::regprocedure))
      like '%insert into public.messages%'
  ,
  'completion RPC combines attempt finalization with durable exchange persistence'
);

insert into auth.users (id, aud, role, email)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'quota-owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'quota-other@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'quota-pro@example.test'),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'quota-counts@example.test'),
  ('10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'quota-month@example.test');

insert into public.conversations (id, user_id, title)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Quota owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Quota other'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'Quota pro'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'Quota counts'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 'Quota month');

update public.profiles
set plan = 'pro'
where id = '10000000-0000-4000-8000-000000000003';

insert into public.image_generation_attempts (
  id,
  user_id,
  conversation_id,
  plan_snapshot,
  status,
  reserved_at,
  expires_at,
  provider_started_at,
  completed_at,
  released_at,
  release_reason,
  provider,
  model,
  estimated_cost_microusd
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000004',
    'free',
    'succeeded',
    now() - interval '2 hours',
    now() - interval '90 minutes',
    now() - interval '110 minutes',
    now() - interval '100 minutes',
    null,
    null,
    'replicate',
    'flux-schnell',
    3000
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000004',
    'free',
    'released',
    now() - interval '2 hours',
    now() - interval '90 minutes',
    now() - interval '110 minutes',
    null,
    now() - interval '80 minutes',
    'provider_failure',
    'replicate',
    'flux-schnell',
    3000
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000004',
    'free',
    'reserved',
    now() - interval '2 hours',
    now() - interval '1 minute',
    null,
    null,
    null,
    null,
    null,
    null,
    null
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$select * from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000001')$$,
  '42501',
  'UNAUTHORIZED',
  'unauthenticated quota reservation is rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select * from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000002')$$,
  'P0001',
  'CONVERSATION_NOT_FOUND',
  'reservation rejects a conversation owned by another user'
);

create temporary table owner_reservations on commit drop as
select *
from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000001');

select is(
  (select plan from owner_reservations),
  'free',
  'reservation resolves the authoritative Free profile plan'
);

select is(
  (select daily_limit from owner_reservations),
  2,
  'Free daily image limit is two'
);

select is(
  (select monthly_limit from owner_reservations),
  10,
  'Free monthly image limit is ten'
);

select is(
  (select daily_remaining from owner_reservations),
  1::bigint,
  'one active reservation leaves one Free daily slot'
);

select is(
  (select monthly_remaining from owner_reservations),
  9::bigint,
  'one active reservation leaves nine Free monthly slots'
);

select is(
  (select status from public.image_generation_attempts where id = (select attempt_id from owner_reservations)),
  'reserved',
  'reservation creates an active reserved attempt'
);

select is(
  (select plan_snapshot from public.image_generation_attempts where id = (select attempt_id from owner_reservations)),
  'free',
  'reservation stores the server-resolved plan snapshot'
);

create temporary table owner_second_reservation on commit drop as
select *
from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000001');

select is(
  (select daily_reserved from owner_second_reservation),
  2::bigint,
  'active reservations count toward daily capacity'
);

select throws_ok(
  $$select * from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'IMAGE_DAILY_LIMIT_REACHED',
  'daily capacity rejects a third Free reservation'
);

select is(
  public.release_image_generation_quota(
    (select attempt_id from owner_reservations),
    'request_aborted'
  ),
  true,
  'owned active reservation changes to released'
);

select is(
  (select status from public.image_generation_attempts where id = (select attempt_id from owner_reservations)),
  'released',
  'released attempt is no longer active'
);

select is(
  public.release_image_generation_quota(
    '40000000-0000-4000-8000-000000000099',
    'request_aborted'
  ),
  false,
  'unknown or non-owned reservation cannot be released'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

-- The counts fixture has one succeeded, one released, and one expired attempt.
-- Its first reservation proves only the successful attempt consumes capacity.
create temporary table counts_reservation on commit drop as
select *
from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000004');

select is(
  (select daily_used from counts_reservation),
  1::bigint,
  'succeeded attempts count toward daily usage'
);

select is(
  (select daily_reserved from counts_reservation),
  1::bigint,
  'expired reservations are released and do not remain active'
);

select is(
  (select status from public.image_generation_attempts where id = '40000000-0000-4000-8000-000000000003'),
  'released',
  'lazy reservation cleanup reclassifies expired attempts'
);

select throws_ok(
  $$select * from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000004')$$,
  'P0001',
  'IMAGE_DAILY_LIMIT_REACHED',
  'serialized reservation capacity cannot exceed the daily limit'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

create temporary table pro_reservation on commit drop as
select *
from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000003');

select is(
  (select plan from pro_reservation),
  'pro',
  'reservation resolves the authoritative Pro profile plan'
);

select is(
  (select daily_limit from pro_reservation),
  20,
  'Pro daily image limit is twenty'
);

select is(
  (select monthly_limit from pro_reservation),
  200,
  'Pro monthly image limit is two hundred'
);

select is(
  public.start_image_generation_attempt(
    (select attempt_id from pro_reservation),
    'replicate',
    'flux-schnell'
  ),
  true,
  'provider-start telemetry marks the reservation before execution'
);

select is(
  (select estimated_cost_microusd from public.image_generation_attempts where id = (select attempt_id from pro_reservation)),
  3000::bigint,
  'known provider/model receives the centralized estimated cost telemetry'
);

select throws_ok(
  $$select * from public.complete_generated_image_generation(
    (select attempt_id from pro_reservation),
    '20000000-0000-4000-8000-000000000002',
    'wrong conversation',
    'generated/10000000-0000-4000-8000-000000000003/20000000-0000-4000-8000-000000000003/wrong.webp',
    'image/webp',
    'replicate',
    'flux-schnell'
  )$$,
  'P0001',
  'IMAGE_ATTEMPT_CONVERSATION_MISMATCH',
  'completion validates reservation conversation identity'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select * from public.complete_generated_image_generation(
    '40000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003',
    'other user',
    'generated/10000000-0000-4000-8000-000000000003/20000000-0000-4000-8000-000000000003/other.webp',
    'image/webp',
    'replicate',
    'flux-schnell'
  )$$,
  'P0001',
  'IMAGE_ATTEMPT_NOT_FOUND',
  'completion validates reservation ownership'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

create temporary table completed_exchange on commit drop as
select *
from public.complete_generated_image_generation(
  (select attempt_id from pro_reservation),
  '20000000-0000-4000-8000-000000000003',
  'A generated image prompt',
  'generated/10000000-0000-4000-8000-000000000003/20000000-0000-4000-8000-000000000003/image.webp',
  'image/webp',
  'replicate',
  'flux-schnell'
);

select is(
  (select count(*)::integer from completed_exchange),
  1,
  'completion returns one durable exchange result'
);

select is(
  (select count(*)::integer from public.messages where id in ((select user_message_id from completed_exchange), (select assistant_message_id from completed_exchange))),
  2,
  'completion creates exactly one user and one assistant message'
);

select is(
  (select count(*)::integer from public.message_generated_images where id = (select generated_image_id from completed_exchange)),
  1,
  'completion creates generated-image metadata'
);

select is(
  (select status from public.image_generation_attempts where id = (select attempt_id from pro_reservation)),
  'succeeded',
  'completion finalizes the quota attempt atomically'
);

select is(
  public.release_image_generation_quota(
    (select attempt_id from pro_reservation),
    'internal_failure'
  ),
  false,
  'a succeeded attempt cannot be released'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

create temporary table failed_completion_reservation on commit drop as
select *
from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000003');

select is(
  public.start_image_generation_attempt(
    (select attempt_id from failed_completion_reservation),
    'replicate',
    'flux-schnell'
  ),
  true,
  'a second reservation can start independently'
);

select throws_ok(
  $$select * from public.complete_generated_image_generation(
    (select attempt_id from failed_completion_reservation),
    '20000000-0000-4000-8000-000000000003',
    'failed completion',
    'not-owned/path.webp',
    'image/webp',
    'replicate',
    'flux-schnell'
  )$$,
  '22023',
  'INVALID_GENERATED_IMAGE',
  'invalid completion input fails before durable inserts'
);

select is(
  (select count(*)::integer from public.messages where content = 'failed completion'),
  0,
  'failed completion creates no partial messages'
);

select is(
  (select status from public.image_generation_attempts where id = (select attempt_id from failed_completion_reservation)),
  'reserved',
  'failed completion leaves the reservation releasable'
);

select is(
  public.release_image_generation_quota(
    (select attempt_id from failed_completion_reservation),
    'persistence_failure'
  ),
  true,
  'failed completion reservation can be released without provider retry'
);

set local role postgres;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

insert into public.image_generation_attempts (
  user_id,
  conversation_id,
  plan_snapshot,
  status,
  reserved_at,
  expires_at,
  provider_started_at,
  completed_at,
  provider,
  model,
  estimated_cost_microusd
)
select
  '10000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000005',
  'free',
  'succeeded',
  now() - interval '20 days',
  now() - interval '19 days',
  now() - interval '19 days',
  (
    (
      date_trunc('month', now() at time zone 'UTC')
      + ((series - 1) % 5) * interval '1 day'
      + interval '12 hours'
    ) at time zone 'UTC'
  ),
  'replicate',
  'flux-schnell',
  3000
from generate_series(1, 10) as series;

set local role authenticated;

select throws_ok(
  $$select * from public.reserve_image_generation_quota('20000000-0000-4000-8000-000000000005')$$,
  'P0001',
  'IMAGE_MONTHLY_LIMIT_REACHED',
  'monthly capacity rejects a Free reservation after ten current-UTC successes'
);

select *
from finish();

rollback;
