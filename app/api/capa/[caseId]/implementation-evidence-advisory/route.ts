import { handleCapaImplementationEvidenceAdvisoryPost } from "@/lib/capa/api/capa-implementation-evidence-advisory-route-handler";
import { createCapaImplementationEvidenceAdvisoryApiDependencies } from "../../capa-next-route-dependencies";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { readonly params: Promise<{ readonly caseId: string }> }): Promise<Response> { const { caseId } = await context.params; return handleCapaImplementationEvidenceAdvisoryPost(request, caseId, createCapaImplementationEvidenceAdvisoryApiDependencies()); }
