begin;

create extension if not exists pgtap;

select plan(29);

-- ---------------------------------------------------------------------------
-- Profile client boundary
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'profiles',
  'profiles table remains present'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.profiles'::regclass
  ),
  'profiles row-level security remains enabled'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Users can view their own profile'
      and cmd = 'SELECT'
  ),
  'authenticated profile reads remain own-row scoped'
);

select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated clients retain profile SELECT'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous clients cannot read profiles'
);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
  'authenticated clients cannot insert profiles'
);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'authenticated clients cannot update profiles'
);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'authenticated clients cannot delete profiles'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'INSERT'),
  'anonymous clients cannot insert profiles'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'UPDATE'),
  'anonymous clients cannot update profiles'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'DELETE'),
  'anonymous clients cannot delete profiles'
);

-- Column-level privileges are checked explicitly because table-level grants
-- and column-level grants are independent PostgreSQL ACLs.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'plan', 'UPDATE'),
  'authenticated clients cannot change plan'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'plan_source', 'UPDATE'),
  'authenticated clients cannot change plan source'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'subscription_status', 'UPDATE'),
  'authenticated clients cannot change subscription status'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'lifetime_pro', 'UPDATE'),
  'authenticated clients cannot change lifetime entitlement'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'stripe_customer_id', 'UPDATE'),
  'authenticated clients cannot change Stripe customer identity'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'stripe_subscription_id', 'UPDATE'),
  'authenticated clients cannot change Stripe subscription identity'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'current_period_end', 'UPDATE'),
  'authenticated clients cannot change the subscription period'
);

select ok(
  not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
  'authenticated clients cannot execute the auth trigger helper'
);

-- These are privilege checks rather than writes, so the qualification cannot
-- mutate a profile while proving that the trusted server path remains valid.
select ok(
  has_table_privilege('service_role', 'public.profiles', 'SELECT'),
  'service role can read profiles'
);

select ok(
  has_table_privilege('service_role', 'public.profiles', 'INSERT'),
  'service role can insert profiles for trusted auth flows'
);

select ok(
  has_table_privilege('service_role', 'public.profiles', 'UPDATE'),
  'service role can update profiles for trusted subscription flows'
);

select ok(
  has_table_privilege('service_role', 'public.profiles', 'DELETE'),
  'service role retains profile delete capability'
);

select ok(
  has_column_privilege('service_role', 'public.profiles', 'plan', 'UPDATE'),
  'service role can update plan'
);

select ok(
  has_column_privilege('service_role', 'public.profiles', 'stripe_customer_id', 'UPDATE'),
  'service role can update Stripe customer identity'
);

-- ---------------------------------------------------------------------------
-- Actual browser-role failure behavior, including own and other rows.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$update public.profiles set plan = 'pro' where id = '10000000-0000-4000-8000-000000000001'::uuid$$,
  '42501',
  null,
  'authenticated Free users cannot grant themselves Pro'
);

select throws_ok(
  $$update public.profiles set plan_source = 'stripe', subscription_status = 'active', lifetime_pro = true, stripe_customer_id = 'cus_attack', stripe_subscription_id = 'sub_attack', current_period_end = now() where id = '10000000-0000-4000-8000-000000000002'::uuid$$,
  '42501',
  null,
  'authenticated users cannot change another profile subscription state'
);

set local role anon;
select throws_ok(
  $$update public.profiles set plan = 'pro' where id = '10000000-0000-4000-8000-000000000001'::uuid$$,
  '42501',
  null,
  'anonymous clients cannot change entitlement state'
);

set local role postgres;
select set_config('request.jwt.claim.sub', null, true);

select ok(
  not has_table_privilege('public', 'public.profiles', 'UPDATE'),
  'PUBLIC does not retain profile UPDATE privilege'
);

select * from finish();

rollback;
