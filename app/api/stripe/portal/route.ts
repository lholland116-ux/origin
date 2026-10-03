import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API_VERSION = "2026-04-22.dahlia";

type ProfileRow = {
  plan: string | null;
  stripe_customer_id: string | null;
};

type StripeCustomerProfileRow = {
  stripe_customer_id: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function getStripe() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!stripeSecretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }

  return new Stripe(stripeSecretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
}

function getAppUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!appUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  }

  return appUrl.replace(/\/$/, "");
}

async function findStripeCustomerByEmail(stripe: Stripe, email: string) {
  const customers = await stripe.customers.list({
    email,
    limit: 1,
  });

  return customers.data[0] ?? null;
}

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("You must be signed in to manage billing.", 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("plan, stripe_customer_id")
      .eq("id", user.id)
      .single<ProfileRow>();

    if (profileError || !profile) {
      console.error("Stripe portal profile lookup error:", profileError);
      return jsonError("Unable to verify your billing profile.", 500);
    }

    if (profile.plan !== "pro") {
      return jsonError("No active Pro plan found.", 400);
    }

    const stripe = getStripe();
    const appUrl = getAppUrl();

    let stripeCustomerId = profile.stripe_customer_id;

    if (!stripeCustomerId && user.email) {
      const customer = await findStripeCustomerByEmail(stripe, user.email);

      if (customer?.id) {
        // Preserve the existing portal behavior for this request even if the
        // best-effort durable backfill encounters a transient database error.
        stripeCustomerId = customer.id;

        const admin = createAdminClient();
        const { data: claimedProfile, error: updateError } = await admin
          .from("profiles")
          .update({ stripe_customer_id: customer.id })
          .eq("id", user.id)
          .is("stripe_customer_id", null)
          .select("stripe_customer_id")
          .maybeSingle<StripeCustomerProfileRow>();

        if (updateError) {
          console.error("Failed to backfill Stripe customer ID:", updateError);
        } else if (claimedProfile?.stripe_customer_id) {
          stripeCustomerId = claimedProfile.stripe_customer_id;
        } else {
          const { data: currentProfile, error: currentProfileError } =
            await admin
              .from("profiles")
              .select("stripe_customer_id")
              .eq("id", user.id)
              .maybeSingle<StripeCustomerProfileRow>();

          if (currentProfileError) {
            console.error(
              "Failed to resolve the current Stripe customer ID:",
              currentProfileError,
            );
          } else if (currentProfile?.stripe_customer_id) {
            stripeCustomerId = currentProfile.stripe_customer_id;
          }
        }
      }
    }

    if (!stripeCustomerId) {
      return jsonError("No Stripe billing customer found for this account.", 400);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${appUrl}/account`,
    });

    if (!session.url) {
      return jsonError("Stripe did not return a billing portal URL.", 500);
    }

    return NextResponse.json(
      { url: session.url },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Stripe portal error:", error);

    const message =
      error instanceof Error ? error.message : "Unable to open billing portal.";

    return jsonError(message, 500);
  }
}
