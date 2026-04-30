import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API_VERSION = "2026-04-22.dahlia";
const MOTHERS_DAY_PROMO_CODE = "MOTHERSDAY";

// Test-mode promotion code ID from Stripe.
// When switching to live mode, create a live promo code and update this env var.
const FALLBACK_MOTHERS_DAY_PROMOTION_CODE_ID = "promo_1TRsVfJX3uw7yuq";

type CheckoutRequestBody = {
  promoCode?: string;
};

function getStripe() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }

  return new Stripe(stripeSecretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
}

function getAppUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  }

  return appUrl.replace(/\/$/, "");
}

function getProPriceId() {
  const priceId = process.env.STRIPE_PRO_PRICE_ID;

  if (!priceId) {
    throw new Error("Missing STRIPE_PRO_PRICE_ID.");
  }

  return priceId;
}

function getMothersDayPromotionCodeId() {
  return (
    process.env.STRIPE_MOTHERSDAY_PROMOTION_CODE_ID ??
    FALLBACK_MOTHERS_DAY_PROMOTION_CODE_ID
  );
}

function normalizePromoCode(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const cleaned = value.trim().toUpperCase();

  if (!cleaned) return null;

  if (!/^[A-Z0-9_-]{3,40}$/.test(cleaned)) return null;

  return cleaned;
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "You must be signed in to upgrade." },
        { status: 401 }
      );
    }

    let body: CheckoutRequestBody = {};

    try {
      body = (await req.json()) as CheckoutRequestBody;
    } catch {
      body = {};
    }

    const requestedPromoCode = normalizePromoCode(body.promoCode);
    const shouldApplyMothersDayPromo =
      requestedPromoCode === MOTHERS_DAY_PROMO_CODE;

    const stripe = getStripe();
    const appUrl = getAppUrl();
    const priceId = getProPriceId();

    const discounts: Array<{ promotion_code: string }> = shouldApplyMothersDayPromo
      ? [{ promotion_code: getMothersDayPromotionCodeId() }]
      : [];

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: user.email ?? undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: discounts.length === 0,
      discounts: discounts.length > 0 ? discounts : undefined,
      success_url: `${appUrl}/account?success=true`,
      cancel_url: `${appUrl}/pricing?canceled=true`,
      metadata: {
        userId: user.id,
        promoCode: requestedPromoCode ?? "",
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          promoCode: requestedPromoCode ?? "",
        },
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);

    return NextResponse.json(
      { error: "Unable to start checkout." },
      { status: 500 }
    );
  }
}