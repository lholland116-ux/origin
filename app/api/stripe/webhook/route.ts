import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

type SubscriptionWithPeriod = Stripe.Subscription & {
  current_period_end?: number | null;
};

function getCurrentPeriodEnd(subscription: Stripe.Subscription): number | null {
  const directValue = (subscription as SubscriptionWithPeriod).current_period_end;

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

function isActiveProStatus(status: Stripe.Subscription.Status) {
  return status === "active" || status === "trialing";
}

async function updateUserSubscription(params: {
  userId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: Stripe.Subscription.Status | string | null;
  currentPeriodEnd?: number | null;
}) {
  const {
    userId,
    stripeCustomerId,
    stripeSubscriptionId,
    subscriptionStatus,
    currentPeriodEnd,
  } = params;

  const plan =
    subscriptionStatus &&
    isActiveProStatus(subscriptionStatus as Stripe.Subscription.Status)
      ? "pro"
      : "free";

  const updatePayload = {
    plan,
    stripe_customer_id: stripeCustomerId ?? null,
    stripe_subscription_id: stripeSubscriptionId ?? null,
    subscription_status: subscriptionStatus ?? null,
    current_period_end: currentPeriodEnd
      ? new Date(currentPeriodEnd * 1000).toISOString()
      : null,
  };

  let query = supabaseAdmin.from("profiles").update(updatePayload);

  if (userId) {
    query = query.eq("id", userId);
  } else if (stripeSubscriptionId) {
    query = query.eq("stripe_subscription_id", stripeSubscriptionId);
  } else if (stripeCustomerId) {
    query = query.eq("stripe_customer_id", stripeCustomerId);
  } else {
    throw new Error(
      "No userId, stripeSubscriptionId, or stripeCustomerId available."
    );
  }

  const { error } = await query;

  if (error) {
    throw error;
  }
}

function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function getSubscriptionId(
  subscription: string | Stripe.Subscription | null
) {
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook handler failed:", error);
    return new NextResponse("Webhook handler failed.", { status: 500 });
  }
}