import { handleCapaImplementationSubmissionPost } from "@/lib/capa/api/capa-implementation-submission-route-handler";
import { createCapaImplementationSubmissionApiDependencies } from "../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly caseId: string }>;
}
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaImplementationSubmissionPost(
    request,
    caseId,
    createCapaImplementationSubmissionApiDependencies(),
  );
}
