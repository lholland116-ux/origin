import {
  handleCapaImplementationWorkspaceGet,
  handleCapaImplementationWorkspacePut,
} from "@/lib/capa/api/capa-implementation-workspace-route-handler";
import { createCapaImplementationWorkspaceApiDependencies } from "../../capa-next-route-dependencies";

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
  return handleCapaImplementationWorkspaceGet(
    request,
    caseId,
    createCapaImplementationWorkspaceApiDependencies(),
  );
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaImplementationWorkspacePut(
    request,
    caseId,
    createCapaImplementationWorkspaceApiDependencies(),
  );
}
