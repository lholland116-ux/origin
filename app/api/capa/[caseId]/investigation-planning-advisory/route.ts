import { handleCapaInvestigationPlanningAdvisoryPost } from "@/lib/capa/api/capa-investigation-planning-advisory-route-handler";
import { createCapaInvestigationPlanningAdvisoryApiDependencies } from "../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InvestigationPlanningAdvisoryRouteContext {
  readonly params: Promise<{ readonly caseId: string }>;
}

export async function POST(
  request: Request,
  context: InvestigationPlanningAdvisoryRouteContext,
): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaInvestigationPlanningAdvisoryPost(
    request,
    caseId,
    createCapaInvestigationPlanningAdvisoryApiDependencies(),
  );
}
