import {
  handleCapaImplementationReviewGet,
  handleCapaImplementationReviewPost,
} from "@/lib/capa/api/capa-implementation-review-route-handler";
import { createCapaImplementationReviewApiDependencies } from "../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly caseId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaImplementationReviewGet(
    request,
    caseId,
    createCapaImplementationReviewApiDependencies(),
  );
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaImplementationReviewPost(
    request,
    caseId,
    createCapaImplementationReviewApiDependencies(),
  );
}
