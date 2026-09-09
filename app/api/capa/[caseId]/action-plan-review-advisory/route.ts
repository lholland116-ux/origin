import { handleCapaActionPlanReviewAdvisoryPost } from "@/lib/capa/api/capa-action-plan-review-advisory-route-handler";
import { createCapaActionPlanReviewAdvisoryApiDependencies } from "../../capa-next-route-dependencies";
export async function POST(request: Request, context: { readonly params: Promise<{ readonly caseId: string }> }): Promise<Response> { const { caseId } = await context.params; return handleCapaActionPlanReviewAdvisoryPost(request, caseId, createCapaActionPlanReviewAdvisoryApiDependencies()); }
