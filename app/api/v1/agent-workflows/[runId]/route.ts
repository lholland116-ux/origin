import { workflowHttpHandlers } from "@/lib/agent-runtime/server-workflow-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  const { runId } = await context.params;
  return workflowHttpHandlers.status(request, runId);
}
