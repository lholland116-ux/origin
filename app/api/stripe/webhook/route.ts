import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API_VERSION = "2026-04-22.dahlia";

type SubscriptionWithPeriod = Stripe.Subscription & {
  current_period_end?: number | null;
};

type SubscriptionStatus = Stripe.Subscription.Status | string | null | undefined;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getStripe() {
  return new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
    apiVersion: STRIPE_API_VERSION,
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

function isActiveProStatus(status: SubscriptionStatus) {
  return status === "active" || status === "trialing";
}

async function updateUserSubscription(params: {
  userId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: SubscriptionStatus;
  currentPeriodEnd?: number | null;
}) {
  const {
    userId,
    stripeCustomerId,
    stripeSubscriptionId,
    subscriptionStatus,
    currentPeriodEnd,
  } = params;

  const supabaseAdmin = getSupabaseAdmin();
  const plan = isActiveProStatus(subscriptionStatus) ? "pro" : "free";

  const updatePayload = {
    plan,
    stripe_customer_id: stripeCustomerId ?? null,
    stripe_subscription_id: stripeSubscriptionId ?? null,
    subscription_status: subscriptionStatus ?? null,
    current_period_end: currentPeriodEnd
      ? new Date(currentPeriodEnd * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };

  let query = supabaseAdmin.from("profiles").update(updatePayload).select("id");

  if (userId) {
    query = query.eq("id", userId);
  } else if (stripeSubscriptionId) {
    query = query.eq("stripe_subscription_id", stripeSubscriptionId);
  } else if (stripeCustomerId) {
    query = query.eq("stripe_customer_id", stripeCustomerId);
  } else {
    throw new Error(
      "Cannot update subscription because no userId, Stripe subscription ID, or Stripe customer ID was available."
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Supabase profile update failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(
      `No Supabase profile was updated. userId=${userId ?? "null"}, stripeCustomerId=${
        stripeCustomerId ?? "null"
      }, stripeSubscriptionId=${stripeSubscriptionId ?? "null"}`
    );
  }

  return data[0];
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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.mode !== "subscription") {
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

        const subscription =
          await stripe.subscriptions.retrieve(stripeSubscriptionId);

        await updateUserSubscription({
          userId,
          stripeCustomerId,
          stripeSubscriptionId,
          subscriptionStatus: subscription.status,
          currentPeriodEnd: getCurrentPeriodEnd(subscription),
        });

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        await updateUserSubscription({
          userId: subscription.metadata?.userId ?? null,
          stripeCustomerId: getCustomerId(subscription.customer),
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          currentPeriodEnd: getCurrentPeriodEnd(subscription),
        });

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;

        console.warn("Stripe invoice payment failed:", {
          invoiceId: invoice.id,
          customerId: getCustomerId(invoice.customer),
        });

        break;
      }

      default: {
        console.log(`Unhandled Stripe event: ${event.type}`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook handler failed:", error);
    return new NextResponse("Webhook handler failed.", { status: 500 });
  }
}