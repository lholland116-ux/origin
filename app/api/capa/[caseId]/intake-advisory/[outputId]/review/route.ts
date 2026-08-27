import {
  handleCapaAiOutputReviewPost,
} from "@/lib/capa/api/capa-ai-output-review-route-handler";

import {
  createCapaAiOutputReviewApiDependencies,
} from "../../../../capa-next-route-dependencies";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface AiOutputReviewRouteContext {
  readonly params:
    Promise<{
      readonly caseId:
        string;

      readonly outputId:
        string;
    }>;
}

export async function POST(
  request: Request,
  context:
    AiOutputReviewRouteContext,
): Promise<Response> {
  const {
    caseId,
    outputId,
  } = await context.params;

  return handleCapaAiOutputReviewPost(
    request,
    caseId,
    outputId,
    createCapaAiOutputReviewApiDependencies(),
  );
}
