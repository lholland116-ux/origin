import { handleCapaInvestigationProgress } from "@/lib/capa/api/capa-route-handler";
import { createCapaApiHandlerDependencies } from "../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly caseId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaInvestigationProgress(
    request,
    caseId,
    createCapaApiHandlerDependencies()
  );
}
