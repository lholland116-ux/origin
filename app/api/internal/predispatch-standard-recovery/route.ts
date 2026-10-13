import "server-only";

import { handleServerPredispatchStandardRecovery } from "@/lib/agent-runtime/server-predispatch-standard-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleServerPredispatchStandardRecovery(request);
}
