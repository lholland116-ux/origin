import {
  handleCapaInvestigationActiveWorkspaceDraftGet,
  handleCapaInvestigationActiveWorkspaceDraftPut,
} from "@/lib/capa/api/capa-investigation-active-workspace-draft-route-handler";
import { createCapaInvestigationActiveWorkspaceDraftApiDependencies } from "../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { readonly params: Promise<{ readonly caseId: string }>; }

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaInvestigationActiveWorkspaceDraftGet(request, caseId, createCapaInvestigationActiveWorkspaceDraftApiDependencies());
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { caseId } = await context.params;
  return handleCapaInvestigationActiveWorkspaceDraftPut(request, caseId, createCapaInvestigationActiveWorkspaceDraftApiDependencies());
}
