import { workflowHttpHandlers } from "@/lib/agent-runtime/server-workflow-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return workflowHttpHandlers.start(request);
}
