import { handleCapaActionPlanAdvisoryPost } from "@/lib/capa/api/capa-action-plan-advisory-route-handler";
import { createCapaActionPlanAdvisoryApiDependencies } from "../../capa-next-route-dependencies";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { readonly params: Promise<{ readonly caseId: string }> }): Promise<Response> { const { caseId } = await context.params; return handleCapaActionPlanAdvisoryPost(request, caseId, createCapaActionPlanAdvisoryApiDependencies()); }
