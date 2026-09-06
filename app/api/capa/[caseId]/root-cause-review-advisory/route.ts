import { handleCapaRootCauseReviewAdvisoryPost } from "@/lib/capa/api/capa-root-cause-review-advisory-route-handler";
import { createCapaRootCauseReviewAdvisoryApiDependencies } from "../../capa-next-route-dependencies";

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
  return handleCapaRootCauseReviewAdvisoryPost(
    request,
    caseId,
    createCapaRootCauseReviewAdvisoryApiDependencies(),
  );
}
