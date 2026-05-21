import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API_VERSION = "2026-04-22.dahlia";
const MEMORIAL_DAY_PROMO_CODE = "MEMORIALDAY";

type CheckoutRequestBody = {
  promoCode?: string;
};

type CheckoutDiscount = {
  promotion_code: string;
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

  if (!stripeSecretKey.startsWith("sk_live_")) {
    throw new Error("STRIPE_SECRET_KEY must be a live Stripe secret key.");
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

function getProPriceId() {
  const priceId = process.env.STRIPE_PRO_PRICE_ID?.trim();

  if (!priceId) {
    throw new Error("Missing STRIPE_PRO_PRICE_ID.");
  }

  if (!priceId.startsWith("price_")) {
    throw new Error("STRIPE_PRO_PRICE_ID must start with price_.");
  }

  return priceId;
}

function getMemorialDayPromotionCodeId() {
  const promotionCodeId =
    process.env.STRIPE_MEMORIALDAY_PROMOTION_CODE_ID?.trim();

  if (!promotionCodeId) {
    throw new Error("Missing STRIPE_MEMORIALDAY_PROMOTION_CODE_ID.");
  }

  if (!promotionCodeId.startsWith("promo_")) {
    throw new Error(
      "STRIPE_MEMORIALDAY_PROMOTION_CODE_ID must start with promo_."
    );
  }

  return promotionCodeId;
}

function normalizePromoCode(promoCode: unknown) {
  if (typeof promoCode !== "string") {
    return "";
  }

  return promoCode.trim().toUpperCase();
}

async function parseCheckoutBody(req: Request): Promise<CheckoutRequestBody> {
  try {
    const body = (await req.json()) as CheckoutRequestBody;
    return body ?? {};
  } catch {
    return {};
  }
}

function getStripeErrorMessage(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return error.message || "Stripe checkout failed.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to start checkout.";
}

export async function POST(req: Request) {
  try {
    const body = await parseCheckoutBody(req);
    const requestedPromoCode = normalizePromoCode(body.promoCode);

    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonError("You must be signed in to upgrade.", 401);
    }

    const stripe = getStripe();
    const appUrl = getAppUrl();
    const priceId = getProPriceId();

    const discounts: CheckoutDiscount[] = [];

    if (requestedPromoCode === MEMORIAL_DAY_PROMO_CODE) {
      discounts.push({
        promotion_code: getMemorialDayPromotionCodeId(),
      });
    } else if (requestedPromoCode) {
      return jsonError("This promo code is not currently available.", 400);
    }

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
      discounts: discounts.length > 0 ? discounts : undefined,
      allow_promotion_codes: discounts.length === 0,
      success_url: `${appUrl}/account?success=true`,
      cancel_url: `${appUrl}/pricing?canceled=true`,
      metadata: {
        userId: user.id,
        promoCode: requestedPromoCode || "NONE",
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          promoCode: requestedPromoCode || "NONE",
        },
      },
    });

    if (!session.url) {
      return jsonError("Stripe did not return a checkout URL.", 500);
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
    const message = getStripeErrorMessage(error);

    console.error("Stripe checkout error:", {
      message,
      type:
        error instanceof Stripe.errors.StripeError ? error.type : "unknown",
      code:
        error instanceof Stripe.errors.StripeError ? error.code : undefined,
      requestId:
        error instanceof Stripe.errors.StripeError
          ? error.requestId
          : undefined,
    });

    return jsonError(message, 500);
  }
}