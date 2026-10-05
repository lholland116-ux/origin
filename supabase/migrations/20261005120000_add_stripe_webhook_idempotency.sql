BEGIN;

-- Persist every successfully handled Stripe event indefinitely.  The event ID
-- primary key is the durable duplicate-delivery guarantee.
CREATE TABLE public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  event_created bigint NOT NULL CHECK (event_created >= 0),
  object_id text,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.stripe_webhook_events.event_created IS
  'Stripe event.created is second-resolution audit metadata only; it is not a causal ordering key.';

-- A profile-scoped lease serializes Stripe reads and entitlement writes.
-- fencing_token prevents an expired holder from committing after a successor.
CREATE TABLE public.stripe_webhook_entitlement_locks (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

-- Keep per-subscription state so ending one subscription does not remove Pro
-- when another active subscription still belongs to the same profile.
CREATE TABLE public.stripe_subscription_entitlements (
  stripe_subscription_id text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id text,
  subscription_status text NOT NULL,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stripe_subscription_entitlements_profile_id_idx
  ON public.stripe_subscription_entitlements (profile_id);

-- Safe additive migration: import only unambiguous existing profile mappings.
INSERT INTO public.stripe_subscription_entitlements (
  stripe_subscription_id,
  profile_id,
  stripe_customer_id,
  subscription_status,
  current_period_end,
  updated_at
)
SELECT
  p.stripe_subscription_id,
  p.id,
  p.stripe_customer_id,
  COALESCE(p.subscription_status, CASE WHEN p.plan = 'pro' AND p.plan_source = 'stripe' THEN 'active' ELSE 'canceled' END),
  p.current_period_end,
  COALESCE(p.updated_at, now())
FROM public.profiles AS p
WHERE p.stripe_subscription_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS other
    WHERE other.stripe_subscription_id = p.stripe_subscription_id
      AND other.id <> p.id
  )
ON CONFLICT (stripe_subscription_id) DO NOTHING;

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_entitlement_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_entitlement_locks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_subscription_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_subscription_entitlements FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stripe_webhook_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.stripe_webhook_entitlement_locks FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.stripe_subscription_entitlements FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acquire_stripe_webhook_entitlement_lock(
  p_profile_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (acquired boolean, fencing_token bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_fencing_token bigint;
BEGIN
  IF p_profile_id IS NULL OR p_lease_token IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Invalid Stripe webhook entitlement lock request';
  END IF;

  INSERT INTO public.stripe_webhook_entitlement_locks AS current_lock (
    profile_id, fencing_token, lease_token, lease_expires_at
  )
  VALUES (
    p_profile_id, 1, p_lease_token, clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET fencing_token = current_lock.fencing_token + 1,
      lease_token = EXCLUDED.lease_token,
      lease_expires_at = EXCLUDED.lease_expires_at
  WHERE current_lock.lease_expires_at IS NULL
     OR current_lock.lease_expires_at <= clock_timestamp()
  RETURNING current_lock.fencing_token INTO v_fencing_token;

  IF v_fencing_token IS NULL THEN
    RETURN QUERY SELECT false, NULL::bigint;
  ELSE
    RETURN QUERY SELECT true, v_fencing_token;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_stripe_webhook_entitlement_lock(
  p_profile_id uuid,
  p_lease_token uuid,
  p_fencing_token bigint
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH released AS (
    UPDATE public.stripe_webhook_entitlement_locks
    SET lease_token = NULL, lease_expires_at = NULL
    WHERE profile_id = p_profile_id
      AND lease_token = p_lease_token
      AND fencing_token = p_fencing_token
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM released);
$function$;

CREATE OR REPLACE FUNCTION public.record_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_object_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inserted boolean;
  v_rows integer;
BEGIN
  INSERT INTO public.stripe_webhook_events (event_id, event_type, event_created, object_id)
  VALUES (p_event_id, p_event_type, p_event_created, p_object_id)
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_rows = 1;
  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_stripe_webhook_entitlement(
  p_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_object_id text,
  p_profile_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_subscription_status text,
  p_current_period_end timestamptz,
  p_lease_token uuid,
  p_fencing_token bigint,
  p_track_upgrade boolean DEFAULT false
)
RETURNS TABLE (processed boolean, should_track_upgrade boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lock public.stripe_webhook_entitlement_locks%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_inserted boolean;
  v_rows integer;
  v_subscription_pro boolean;
BEGIN
  SELECT * INTO v_lock
  FROM public.stripe_webhook_entitlement_locks
  WHERE profile_id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_lock.lease_token IS DISTINCT FROM p_lease_token
     OR v_lock.fencing_token IS DISTINCT FROM p_fencing_token
     OR v_lock.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Stripe webhook entitlement lease is missing, expired, or fenced';
  END IF;

  INSERT INTO public.stripe_webhook_events (
    event_id, event_type, event_created, object_id, profile_id
  ) VALUES (
    p_event_id, p_event_type, p_event_created, p_object_id, p_profile_id
  ) ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_rows = 1;

  IF NOT v_inserted THEN
    UPDATE public.stripe_webhook_entitlement_locks
    SET lease_token = NULL, lease_expires_at = NULL
    WHERE profile_id = p_profile_id
      AND lease_token = p_lease_token
      AND fencing_token = p_fencing_token;
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  IF p_stripe_subscription_id IS NULL OR p_subscription_status IS NULL THEN
    RAISE EXCEPTION 'Stripe subscription identity and status are required';
  END IF;

  INSERT INTO public.stripe_subscription_entitlements (
    stripe_subscription_id,
    profile_id,
    stripe_customer_id,
    subscription_status,
    current_period_end,
    updated_at
  ) VALUES (
    p_stripe_subscription_id,
    p_profile_id,
    p_stripe_customer_id,
    p_subscription_status,
    p_current_period_end,
    clock_timestamp()
  )
  ON CONFLICT (stripe_subscription_id) DO UPDATE
  SET stripe_customer_id = EXCLUDED.stripe_customer_id,
      subscription_status = EXCLUDED.subscription_status,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = EXCLUDED.updated_at
  WHERE stripe_subscription_entitlements.profile_id = EXCLUDED.profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stripe subscription is already mapped to a different profile';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stripe webhook profile does not exist';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.stripe_subscription_entitlements AS ent
    WHERE ent.profile_id = p_profile_id
      AND ent.subscription_status IN ('active', 'trialing')
  ) INTO v_subscription_pro;

  UPDATE public.profiles
  SET plan = CASE
        WHEN v_profile.lifetime_pro OR (v_profile.plan = 'pro' AND v_profile.plan_source = 'manual') THEN 'pro'
        WHEN v_subscription_pro THEN 'pro'
        ELSE 'free'
      END,
      plan_source = CASE
        WHEN v_profile.lifetime_pro OR (v_profile.plan = 'pro' AND v_profile.plan_source = 'manual') THEN 'manual'
        WHEN v_subscription_pro THEN 'stripe'
        ELSE 'manual'
      END,
      stripe_customer_id = p_stripe_customer_id,
      stripe_subscription_id = p_stripe_subscription_id,
      subscription_status = p_subscription_status,
      current_period_end = p_current_period_end,
      updated_at = clock_timestamp()
  WHERE id = p_profile_id;

  UPDATE public.stripe_webhook_entitlement_locks
  SET lease_token = NULL, lease_expires_at = NULL
  WHERE profile_id = p_profile_id
    AND lease_token = p_lease_token
    AND fencing_token = p_fencing_token;

  RETURN QUERY SELECT true, p_track_upgrade AND p_subscription_status IN ('active', 'trialing');
END;
$function$;

REVOKE ALL ON FUNCTION public.acquire_stripe_webhook_entitlement_lock(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_stripe_webhook_entitlement_lock(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_stripe_webhook_event(text, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_stripe_webhook_entitlement(text, text, bigint, text, uuid, text, text, text, timestamptz, uuid, bigint, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_stripe_webhook_entitlement_lock(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stripe_webhook_entitlement_lock(uuid, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_webhook_event(text, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_stripe_webhook_entitlement(text, text, bigint, text, uuid, text, text, text, timestamptz, uuid, bigint, boolean) TO service_role;

COMMIT;
