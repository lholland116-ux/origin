import { handleCapaContainmentRiskAdvisoryPost } from "@/lib/capa/api/capa-containment-risk-advisory-route-handler";
import { createCapaContainmentRiskAdvisoryApiDependencies } from "../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ContainmentRiskAdvisoryRouteContext {
  readonly params: Promise<{ readonly caseId: string }>;
}

export async function POST(
  request: Request,
  context: ContainmentRiskAdvisoryRouteContext,
): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaContainmentRiskAdvisoryPost(
    request,
    caseId,
    createCapaContainmentRiskAdvisoryApiDependencies(),
  );
}
