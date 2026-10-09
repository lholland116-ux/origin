import "server-only";
import { handleServerExecutionTrigger } from "@/lib/agent-runtime/server-execution-trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleServerExecutionTrigger(request);
}
