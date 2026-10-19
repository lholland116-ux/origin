import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureMarketingLead } from "@/lib/marketing/lead-capture-service";
import { getMarketingTurnstileConfig, verifyMarketingTurnstileToken } from "@/lib/marketing/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 12_288;
const BODY_READ_TIMEOUT_MS = 5_000;

function reply(status: number, body: Readonly<Record<string, string>>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function readBoundedJson(request: NextRequest): Promise<unknown | null> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) return null;
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + BODY_READ_TIMEOUT_MS;
  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        await reader.cancel();
        return null;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("body_timeout")), remainingMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  const body = await readBoundedJson(request);
  if (body === null) return reply(400, { error: "invalid_request" });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const turnstileConfig = getMarketingTurnstileConfig();
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL || !turnstileConfig) {
    return reply(503, { error: "submission_unavailable" });
  }

  const result = await captureMarketingLead(
    body,
    serviceRoleKey,
    (token) => verifyMarketingTurnstileToken(token, turnstileConfig), async (args) => {
      const { data, error } = await createAdminClient().rpc("submit_marketing_lead", args);
      if (error) throw new Error("submission_unavailable");
      return data;
    },
  );

  switch (result.status) {
    case "created": return reply(201, { status: "received" });
    case "duplicate": return reply(200, { status: "received" });
    case "spam": return reply(202, { status: "received" });
    case "rate_limited": return reply(429, { error: "rate_limited" });
    case "conflict": return reply(409, { error: "submission_conflict" });
    case "verification_failed": return reply(400, { error: "verification_failed" });
    case "invalid": return reply(400, { error: "invalid_request" });
    case "unavailable": return reply(503, { error: "submission_unavailable" });
  }
}
