import "server-only";

import { handleServerDocumentGenerationRecovery } from "@/lib/agent-runtime/server-document-generation-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleServerDocumentGenerationRecovery(request);
}
