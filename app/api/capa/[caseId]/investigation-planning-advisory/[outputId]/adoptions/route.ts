import { handleCapaInvestigationPlanningAdoptionPost } from "@/lib/capa/api/capa-investigation-planning-adoption-route-handler";
import { createCapaInvestigationPlanningAdoptionApiDependencies } from "../../../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly caseId: string;
    readonly outputId: string;
  }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { caseId, outputId } = await context.params;
  return handleCapaInvestigationPlanningAdoptionPost(
    request,
    caseId,
    outputId,
    createCapaInvestigationPlanningAdoptionApiDependencies(),
  );
}
