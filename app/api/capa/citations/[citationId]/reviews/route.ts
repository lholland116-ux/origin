import {
  handleCapaCitationReviewPost,
} from "@/lib/capa/api/capa-citation-review-route-handler";

import {
  createCapaCitationReviewApiDependencies,
} from "../../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CitationReviewRouteContext {
  readonly params: Promise<{
    readonly citationId: string;
  }>;
}

export async function POST(
  request: Request,
  context: CitationReviewRouteContext,
): Promise<Response> {
  const { citationId } = await context.params;
  return handleCapaCitationReviewPost(
    request,
    citationId,
    createCapaCitationReviewApiDependencies(),
  );
}
