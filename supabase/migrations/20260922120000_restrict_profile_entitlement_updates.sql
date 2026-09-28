-- Subscription-controlled profile state is server-managed.  Browser clients
-- retain the existing own-row SELECT behavior, while all profile writes are
-- reserved for the service-role/admin paths used by authentication and Stripe.

revoke all privileges on table public.profiles from public, anon, authenticated;

revoke all privileges (
  id,
  plan,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_status,
  current_period_end,
  created_at,
  updated_at,
  plan_source,
  lifetime_pro
)
on table public.profiles
from public, anon, authenticated;

grant select on table public.profiles to authenticated;

-- This trigger-only function has no browser-facing use.  Remove the legacy
-- execute grants inherited from the remote baseline without affecting the
-- auth.users trigger, which runs as the function owner.
revoke all privileges on function public.handle_new_user() from public, anon, authenticated;
