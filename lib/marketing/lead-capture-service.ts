import { createHash, createHmac, randomUUID } from "node:crypto";
import { marketingLeadRequestSchema, type MarketingLeadRequest, type MarketingLeadSubmitStatus } from "./lead-contract";

export type MarketingLeadRpcArguments = Readonly<{
  p_lead_id: string;
  p_idempotency_key: string;
  p_request_fingerprint: string;
  p_email_fingerprint: string;
  p_name: string;
  p_business_email: string;
  p_company: string;
  p_role: string;
  p_workflow_problem: string;
  p_interest_type: "early_access" | "demo";
  p_current_process_tools: string | null;
  p_marketing_consent: boolean;
  p_source: string;
  p_utm_source: string | null;
  p_utm_medium: string | null;
  p_utm_campaign: string | null;
}>;

export type MarketingLeadCaptureResult =
  | { readonly status: "invalid" }
  | { readonly status: "verification_failed" }
  | { readonly status: "spam" }
  | { readonly status: MarketingLeadSubmitStatus }
  | { readonly status: "unavailable" };

function fingerprint(secret: string, value: string): string {
  return createHmac("sha256", secret)
    .update("lvtchat:marketing-lead-rate:v1\0", "utf8")
    .update("email\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function requestFingerprint(input: MarketingLeadRequest): string {
  const canonical = {
    name: input.name,
    business_email: input.business_email,
    company: input.company,
    role: input.role,
    workflow_problem: input.workflow_problem,
    interest_type: input.interest_type,
    current_process_tools: input.current_process_tools ?? null,
    marketing_consent: input.marketing_consent,
    source: input.source,
    utm_source: input.utm_source ?? null,
    utm_medium: input.utm_medium ?? null,
    utm_campaign: input.utm_campaign ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export async function captureMarketingLead(
  value: unknown,
  serverKey: string,
  verifyToken: (token: string) => Promise<"verified" | "invalid" | "unavailable">,
  persist: (arguments_: MarketingLeadRpcArguments) => Promise<unknown>,
): Promise<MarketingLeadCaptureResult> {
  const parsed = marketingLeadRequestSchema.safeParse(value);
  if (!parsed.success) return { status: "invalid" };
  const input = parsed.data;
  if (!serverKey) return { status: "unavailable" };

  let verification: "verified" | "invalid" | "unavailable";
  try {
    verification = await verifyToken(input.turnstile_token);
  } catch {
    return { status: "unavailable" };
  }
  if (verification === "invalid") return { status: "verification_failed" };
  if (verification !== "verified") return { status: "unavailable" };
  if (input.website?.trim()) return { status: "spam" };

  const arguments_: MarketingLeadRpcArguments = {
    p_lead_id: randomUUID(),
    p_idempotency_key: input.idempotency_key,
    p_request_fingerprint: requestFingerprint(input),
    p_email_fingerprint: fingerprint(serverKey, input.business_email),
    p_name: input.name,
    p_business_email: input.business_email,
    p_company: input.company,
    p_role: input.role,
    p_workflow_problem: input.workflow_problem,
    p_interest_type: input.interest_type,
    p_current_process_tools: input.current_process_tools ?? null,
    p_marketing_consent: input.marketing_consent,
    p_source: input.source,
    p_utm_source: input.utm_source ?? null,
    p_utm_medium: input.utm_medium ?? null,
    p_utm_campaign: input.utm_campaign ?? null,
  };

  try {
    const result = await persist(arguments_);
    if (result === "created" || result === "duplicate" || result === "conflict" || result === "rate_limited") {
      return { status: result };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
