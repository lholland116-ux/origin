import {
  handleCapaActionPlanWorkspaceDraftGet,
  handleCapaActionPlanWorkspaceDraftPut,
} from "@/lib/capa/api/capa-action-plan-workspace-draft-route-handler";
import { createCapaActionPlanWorkspaceDraftApiDependencies } from "../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { readonly params: Promise<{ readonly caseId: string }>; }

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaActionPlanWorkspaceDraftGet(request, caseId, createCapaActionPlanWorkspaceDraftApiDependencies());
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaActionPlanWorkspaceDraftPut(request, caseId, createCapaActionPlanWorkspaceDraftApiDependencies());
}
