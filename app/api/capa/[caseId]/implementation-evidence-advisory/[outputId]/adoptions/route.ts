import { handleCapaImplementationEvidenceAdvisoryAdoptionPost } from "@/lib/capa/api/capa-implementation-evidence-advisory-adoption-route-handler";
import { createCapaImplementationEvidenceAdvisoryAdoptionApiDependencies } from "../../../../capa-next-route-dependencies";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { readonly params: Promise<{ readonly caseId: string; readonly outputId: string }> }): Promise<Response> { const { caseId, outputId } = await context.params; return handleCapaImplementationEvidenceAdvisoryAdoptionPost(request, caseId, outputId, createCapaImplementationEvidenceAdvisoryAdoptionApiDependencies()); }
