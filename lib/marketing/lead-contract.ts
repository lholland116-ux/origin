import { z } from "zod";

export const MARKETING_LEAD_SOURCES = [
  "homepage",
  "workflow_automation",
  "workflow_preview",
  "pricing",
  "about",
  "faq",
  "direct",
  "other",
] as const;

export function isMarketingLeadSource(value: string | undefined): value is (typeof MARKETING_LEAD_SOURCES)[number] {
  return MARKETING_LEAD_SOURCES.some((source) => source === value);
}

const utmValue = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9._~%-]*$/, "Use letters, numbers, dots, dashes, or underscores.")
  .optional()
  .transform((value) => value || undefined);

export const marketingLeadRequestSchema = z.object({
  idempotency_key: z.string().uuid(),
  turnstile_token: z.string().min(1).max(2048).refine((token) => token.trim() === token),
  name: z.string().trim().min(1).max(120),
  business_email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  company: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(160),
  workflow_problem: z.string().trim().min(8).max(2400),
  interest_type: z.enum(["early_access", "demo"]),
  current_process_tools: z.string().trim().max(1200).optional().transform((value) => value || undefined),
  marketing_consent: z.boolean().default(false),
  source: z.enum(MARKETING_LEAD_SOURCES).default("other"),
  utm_source: utmValue,
  utm_medium: utmValue,
  utm_campaign: utmValue,
  website: z.string().max(200).optional(),
}).strict();

export type MarketingLeadRequest = z.infer<typeof marketingLeadRequestSchema>;

export type MarketingLeadSubmitStatus = "created" | "duplicate" | "conflict" | "rate_limited";
