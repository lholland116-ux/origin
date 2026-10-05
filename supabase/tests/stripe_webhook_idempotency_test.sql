BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(26);

SELECT has_table('public', 'stripe_webhook_events', 'Stripe event ledger exists');
SELECT has_pk('public', 'stripe_webhook_events', 'Stripe event IDs are unique');
SELECT has_table('public', 'stripe_webhook_entitlement_locks', 'PostgreSQL entitlement lease table exists');
SELECT has_table('public', 'stripe_subscription_entitlements', 'per-subscription entitlement state exists');
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.stripe_webhook_events'::regclass)
  AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.stripe_webhook_entitlement_locks'::regclass)
  AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.stripe_subscription_entitlements'::regclass),
  'Stripe state tables force RLS'
);
SELECT ok(
  has_function_privilege('service_role', 'public.acquire_stripe_webhook_entitlement_lock(uuid,uuid,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.finalize_stripe_webhook_entitlement(text,text,bigint,text,uuid,text,text,text,timestamptz,uuid,bigint,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.finalize_stripe_webhook_entitlement(text,text,bigint,text,uuid,text,text,text,timestamptz,uuid,bigint,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.finalize_stripe_webhook_entitlement(text,text,bigint,text,uuid,text,text,text,timestamptz,uuid,bigint,boolean)', 'EXECUTE'),
  'only service_role can acquire and finalize Stripe entitlement writes'
);

INSERT INTO auth.users (id, aud, role, email)
VALUES
  ('a2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'stripe-lifetime@example.test'),
  ('a2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'stripe-manual@example.test'),
  ('a2000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'stripe-retry@example.test');

UPDATE public.profiles SET lifetime_pro = true WHERE id = 'a2000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET plan = 'pro', plan_source = 'manual' WHERE id = 'a2000000-0000-4000-8000-000000000002';

SELECT is(
  (SELECT acquired FROM public.acquire_stripe_webhook_entitlement_lock('a2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 60)),
  true,
  'first delivery acquires its PostgreSQL profile lease'
);
SELECT is(
  (SELECT acquired FROM public.acquire_stripe_webhook_entitlement_lock('a2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 60)),
  false,
  'a simultaneous delivery cannot enter the same profile critical section'
);

SELECT is(
  (SELECT processed FROM public.finalize_stripe_webhook_entitlement(
    'evt_stripe_first', 'customer.subscription.updated', 1800000000, 'sub_first',
    'a2000000-0000-4000-8000-000000000001', 'sub_first', 'cus_first', 'active',
    now() + interval '30 days', 'b2000000-0000-4000-8000-000000000001', 1, false
  )),
  true,
  'first delivery commits its event and entitlement together'
);
SELECT is(
  (SELECT plan FROM public.profiles WHERE id = 'a2000000-0000-4000-8000-000000000001'),
  'pro',
  'lifetime Pro remains Pro after a Stripe entitlement write'
);
SELECT is(
  (SELECT plan_source FROM public.profiles WHERE id = 'a2000000-0000-4000-8000-000000000001'),
  'manual',
  'lifetime Pro keeps its manual plan source'
);

SELECT is(
  (SELECT acquired FROM public.acquire_stripe_webhook_entitlement_lock('a2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000003', 60)),
  true,
  'profile lease is released on successful finalize'
);
SELECT is(
  (SELECT processed FROM public.finalize_stripe_webhook_entitlement(
    'evt_stripe_first', 'customer.subscription.deleted', 1800000001, 'sub_first',
    'a2000000-0000-4000-8000-000000000001', 'sub_first', 'cus_first', 'canceled',
    NULL, 'b2000000-0000-4000-8000-000000000003', 2, false
  )),
  false,
  'exact duplicate event is ignored'
);
SELECT is(
  (SELECT subscription_status FROM public.profiles WHERE id = 'a2000000-0000-4000-8000-000000000001'),
  'active',
  'duplicate delivery does not repeat or alter entitlement writes'
);

SELECT is(
  (SELECT acquired FROM public.acquire_stripe_webhook_entitlement_lock('a2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000004', 60)),
  true,
  'manual-Pro profile acquires the lease'
);
SELECT is(
  (SELECT processed FROM public.finalize_stripe_webhook_entitlement(
    'evt_stripe_manual', 'customer.subscription.deleted', 1800000000, 'sub_manual',
    'a2000000-0000-4000-8000-000000000002', 'sub_manual', 'cus_manual', 'canceled',
    NULL, 'b2000000-0000-4000-8000-000000000004', 1, false
  )),
  true,
  'manual-Pro subscription event is processed'
);
SELECT is(
  (SELECT plan || ':' || plan_source FROM public.profiles WHERE id = 'a2000000-0000-4000-8000-000000000002'),
  'pro:manual',
  'manual Pro is preserved when Stripe subscription is canceled'
);

SELECT is(
  (SELECT acquired FROM public.acquire_stripe_webhook_entitlement_lock('a2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000005', 60)),
  true,
  'retry fixture acquires lease'
);
SELECT throws_ok(
  $$SELECT * FROM public.finalize_stripe_webhook_entitlement(
    'evt_stripe_retry', 'customer.subscription.updated', 1800000000, 'sub_retry',
    'a2000000-0000-4000-8000-000000000003', 'sub_retry', 'cus_retry', NULL,
    NULL, 'b2000000-0000-4000-8000-000000000005', 1, false
  )$$,
  'P0001',
  'Stripe subscription identity and status are required',
  'invalid entitlement state aborts the full finalize transaction'
);
SELECT is(
  (SELECT count(*)::integer FROM public.stripe_webhook_events WHERE event_id = 'evt_stripe_retry'),
  0,
  'failed entitlement transaction does not persist its event ID'
);
SELECT is(
  public.release_stripe_webhook_entitlement_lock('a2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000005', 1),
  true,
  'failed transaction lease can be safely released for retry'
);
SELECT is(
  (SELECT acquired FROM public.acquire_stripe_webhook_entitlement_lock('a2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000006', 60)),
  true,
  'retry reacquires a new fencing generation'
);
SELECT is(
  (SELECT processed FROM public.finalize_stripe_webhook_entitlement(
    'evt_stripe_retry', 'customer.subscription.updated', 1800000000, 'sub_retry',
    'a2000000-0000-4000-8000-000000000003', 'sub_retry', 'cus_retry', 'active',
    NULL, 'b2000000-0000-4000-8000-000000000006', 2, false
  )),
  true,
  'same event succeeds on retry after transaction rollback'
);
SELECT is(
  (SELECT count(*)::integer FROM public.stripe_webhook_events WHERE event_id = 'evt_stripe_retry'),
  1,
  'successful retry persists exactly one event row'
);

SELECT is(
  (SELECT public.record_stripe_webhook_event('evt_stripe_analytics', 'checkout.session.completed', 1800000000, 'cs_analytics')),
  true,
  'first non-entitlement event may trigger its post-commit side effect'
);
SELECT is(
  (SELECT public.record_stripe_webhook_event('evt_stripe_analytics', 'checkout.session.completed', 1800000000, 'cs_analytics')),
  false,
  'duplicate non-entitlement event cannot repeat its side effect'
);

SELECT * FROM finish();
ROLLBACK;
