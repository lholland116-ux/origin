import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API_VERSION = "2026-04-22.dahlia";
const PRO_UPGRADE_VALUE = 5.99;

type SubscriptionWithPeriod = Stripe.Subscription & {
  current_period_end?: number | null;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getStripe() {
  const secretKey = requiredEnv("STRIPE_SECRET_KEY");

  if (
    process.env.NODE_ENV === "production" &&
    !secretKey.startsWith("sk_live_")
  ) {
    throw new Error("Production Stripe configuration must use a live secret key.");
  }

  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 10_000,
  });
}

function getSupabaseAdmin() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

function getCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
) {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function getSubscriptionId(subscription: string | Stripe.Subscription | null) {
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

function getCurrentPeriodEnd(subscription: Stripe.Subscription): number | null {
  const directValue = (subscription as SubscriptionWithPeriod)
    .current_period_end;

  if (typeof directValue === "number") {
    return directValue;
  }

  const firstItem = subscription.items?.data?.[0] as
    | (Stripe.SubscriptionItem & { current_period_end?: number | null })
    | undefined;

  return typeof firstItem?.current_period_end === "number"
    ? firstItem.current_period_end
    : null;
}

async function trackProUpgrade(params: {
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}) {
  const measurementId =
    process.env.GA_MEASUREMENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();

  const apiSecret = process.env.GA_API_SECRET?.trim();

  if (!measurementId || !apiSecret) {
    return;
  }

  try {
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: params.userId,
          user_id: params.userId,
          events: [
            {
              name: "pro_upgrade",
              params: {
                value: PRO_UPGRADE_VALUE,
                currency: "USD",
                stripe_customer_id: params.stripeCustomerId ?? "unknown",
                stripe_subscription_id:
                  params.stripeSubscriptionId ?? "unknown",
              },
            },
          ],
        }),
      }
    );
  } catch (error) {
    console.warn("GA4 pro_upgrade tracking failed:", error);
  }
}

type StripeWebhookEvent = Stripe.Event & { created: number };

type Lease = { token: string; fencingToken: number };

function rpcRow<T>(data: unknown): T | null {
  if (!Array.isArray(data)) return null;
  return (data[0] as T | undefined) ?? null;
}

async function resolveProfileId(params: {
  userId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
}) {
  const { userId, stripeSubscriptionId, stripeCustomerId } = params;
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin.from("profiles").select("id");

  if (userId) query = query.eq("id", userId);
  else if (stripeSubscriptionId)
    query = query.eq("stripe_subscription_id", stripeSubscriptionId);
  else if (stripeCustomerId) query = query.eq("stripe_customer_id", stripeCustomerId);
  else throw new Error("Stripe event has no profile lookup identity.");

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Supabase profile lookup failed: ${error.message}`);
  if (!data?.id) throw new Error("No unique Supabase profile matched the Stripe event.");
  return data.id as string;
}

async function acquireProfileLease(profileId: string): Promise<Lease> {
  const supabaseAdmin = getSupabaseAdmin();
  const token = randomUUID();
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const { data, error } = await supabaseAdmin.rpc(
      "acquire_stripe_webhook_entitlement_lock",
      { p_profile_id: profileId, p_lease_token: token, p_lease_seconds: 60 }
    );
    if (error) throw new Error(`Stripe entitlement lock failed: ${error.message}`);
    const result = rpcRow<{ acquired: boolean; fencing_token: number | null }>(data);
    if (result?.acquired && result.fencing_token !== null) {
      return { token, fencingToken: result.fencing_token };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error("Timed out waiting for the Stripe entitlement lock.");
}

async function releaseProfileLease(profileId: string, lease: Lease) {
  const { error } = await getSupabaseAdmin().rpc(
    "release_stripe_webhook_entitlement_lock",
    {
      p_profile_id: profileId,
      p_lease_token: lease.token,
      p_fencing_token: lease.fencingToken,
    }
  );
  if (error) throw new Error(`Stripe entitlement lock release failed: ${error.message}`);
}

async function processSubscriptionEvent(params: {
  event: StripeWebhookEvent;
  stripe: Stripe;
  objectId: string;
  profileId: string;
  subscriptionId: string;
  trackUpgrade: boolean;
}) {
  const { event, stripe, objectId, profileId, subscriptionId, trackUpgrade } = params;
  const lease = await acquireProfileLease(profileId);
  try {
    // Serialize before reading Stripe's canonical state. The lease is held
    // through the atomic database commit, so delayed snapshots cannot win.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const subscriptionUserId = subscription.metadata?.userId;
    if (subscriptionUserId && subscriptionUserId !== profileId) {
      throw new Error("Current Stripe subscription metadata does not match its profile.");
    }

    // This RPC atomically inserts the event ID, updates per-subscription state,
    // recomputes the profile entitlement, and releases the lease.
    const currentPeriodEnd = getCurrentPeriodEnd(subscription);
    const { data, error } = await getSupabaseAdmin().rpc(
      "finalize_stripe_webhook_entitlement",
      {
        p_event_id: event.id,
        p_event_type: event.type,
        p_event_created: event.created,
        p_object_id: objectId,
        p_profile_id: profileId,
        p_stripe_subscription_id: subscription.id,
        p_stripe_customer_id: getCustomerId(subscription.customer),
        p_subscription_status: subscription.status,
        p_current_period_end: currentPeriodEnd
          ? new Date(currentPeriodEnd * 1000).toISOString()
          : null,
        p_lease_token: lease.token,
        p_fencing_token: lease.fencingToken,
        p_track_upgrade: trackUpgrade,
      }
    );
    if (error) throw new Error(`Stripe entitlement transaction failed: ${error.message}`);

    const result = rpcRow<{ processed: boolean; should_track_upgrade: boolean }>(data);
    if (!result || typeof result.processed !== "boolean") {
      throw new Error("Stripe entitlement transaction returned an invalid result.");
    }
    return result;
  } catch (error) {
    try {
      await releaseProfileLease(profileId, lease);
    } catch (releaseError) {
      console.error("Stripe entitlement lock cleanup failed; lease will expire:", releaseError);
    }
    throw error;
  }
}

async function recordEvent(event: StripeWebhookEvent, objectId: string | null) {
  const { data, error } = await getSupabaseAdmin().rpc(
    "record_stripe_webhook_event",
    {
      p_event_id: event.id,
      p_event_type: event.type,
      p_event_created: event.created,
      p_object_id: objectId,
    }
  );
  if (error) throw new Error(`Stripe event persistence failed: ${error.message}`);
  if (typeof data !== "boolean") {
    throw new Error("Stripe event persistence returned an invalid result.");
  }
  return data === true;
}

export async function POST(req: Request) {
  let stripe: Stripe;

  try {
    stripe = getStripe();
  } catch (error) {
    console.error(error);
    return new NextResponse("Stripe is not configured.", { status: 500 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET.");
    return new NextResponse("Webhook secret is not configured.", {
      status: 500,
    });
  }

  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new NextResponse("Missing Stripe signature.", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return new NextResponse("Invalid webhook signature.", { status: 400 });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const configuredLiveMode = stripeSecretKey.startsWith("sk_live_");
  const configuredTestMode = stripeSecretKey.startsWith("sk_test_");

  if (
    typeof event.livemode === "boolean" &&
    ((configuredLiveMode && !event.livemode) ||
      (configuredTestMode && event.livemode))
  ) {
    console.error(
      "Stripe webhook event mode does not match Stripe API key mode."
    );
    return new NextResponse("Webhook mode does not match Stripe configuration.", {
      status: 400,
    });
  }

  try {
    const webhookEvent = event as StripeWebhookEvent;
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.mode !== "subscription") {
          await recordEvent(webhookEvent, session.id);
          break;
        }

        const userId = session.metadata?.userId ?? null;
        const stripeCustomerId = getCustomerId(session.customer);
        const stripeSubscriptionId = getSubscriptionId(session.subscription);

        if (!userId) {
          throw new Error(
            "Missing userId in checkout.session.completed metadata."
          );
        }

        if (!stripeSubscriptionId) {
          throw new Error(
            "Missing subscription ID on checkout.session.completed."
          );
        }

        const profileId = await resolveProfileId({ userId });
        const result = await processSubscriptionEvent({
          event: webhookEvent,
          stripe,
          objectId: session.id,
          profileId,
          subscriptionId: stripeSubscriptionId,
          trackUpgrade: true,
        });

        if (result.should_track_upgrade) {
          await trackProUpgrade({
            userId,
            stripeCustomerId,
            stripeSubscriptionId,
          });
        }

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const eventSubscription = event.data.object as Stripe.Subscription;
        const profileId = await resolveProfileId({
          userId: eventSubscription.metadata?.userId,
          stripeSubscriptionId: eventSubscription.id,
          stripeCustomerId: getCustomerId(eventSubscription.customer),
        });
        await processSubscriptionEvent({
          event: webhookEvent,
          stripe,
          objectId: eventSubscription.id,
          profileId,
          subscriptionId: eventSubscription.id,
          trackUpgrade: false,
        });

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (await recordEvent(webhookEvent, invoice.id)) {
          console.warn("Stripe invoice payment failed:", {
            invoiceId: invoice.id,
            customerId: getCustomerId(invoice.customer),
          });
        }

        break;
      }

      default: {
        await recordEvent(webhookEvent, (event.data.object as { id?: string })?.id ?? null);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook handler failed:", error);
    return new NextResponse("Webhook handler failed.", { status: 500 });
  }
}
