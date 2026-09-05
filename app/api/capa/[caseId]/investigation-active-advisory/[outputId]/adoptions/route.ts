import { handleCapaInvestigationActiveAdoptionPost } from "@/lib/capa/api/capa-investigation-active-adoption-route-handler";
import { createCapaInvestigationActiveAdoptionApiDependencies } from "../../../../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { readonly params: Promise<{ readonly caseId: string; readonly outputId: string }>; }
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { caseId, outputId } = await context.params;
  return handleCapaInvestigationActiveAdoptionPost(request, caseId, outputId, createCapaInvestigationActiveAdoptionApiDependencies());
}
