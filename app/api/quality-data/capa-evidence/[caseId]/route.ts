import { handleQualityDataCapaSupportingEvidenceGet } from "@/lib/quality-data/quality-data-ai-api";
import { qualityDataIntelligenceDependencies } from "../../intelligence/quality-data-intelligence-dependencies";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(request: Request, context: { readonly params: Promise<{ readonly caseId: string }> }): Promise<Response> {
  const params = await context.params;
  return handleQualityDataCapaSupportingEvidenceGet(request, params.caseId, qualityDataIntelligenceDependencies());
}
