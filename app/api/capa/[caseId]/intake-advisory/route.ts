import {
  handleCapaIntakeAdvisoryPost,
} from "@/lib/capa/api/capa-intake-advisory-route-handler";

import {
  createCapaIntakeAdvisoryApiDependencies,
} from "../../capa-next-route-dependencies";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface IntakeAdvisoryRouteContext {
  readonly params:
    Promise<{
      readonly caseId:
        string;
    }>;
}

export async function POST(
  request: Request,
  context:
    IntakeAdvisoryRouteContext,
): Promise<Response> {
  const {
    caseId,
  } = await context.params;

  return handleCapaIntakeAdvisoryPost(
    request,
    caseId,
    createCapaIntakeAdvisoryApiDependencies(),
  );
}
