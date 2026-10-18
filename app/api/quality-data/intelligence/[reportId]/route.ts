import { handleQualityDataIntelligenceGet } from "@/lib/quality-data/quality-data-ai-api";
import { qualityDataIntelligenceDependencies } from "../quality-data-intelligence-dependencies";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request, context: { readonly params: Promise<{ readonly reportId: string }> }): Promise<Response> {
  const params = await context.params;
  return handleQualityDataIntelligenceGet(request, params.reportId, qualityDataIntelligenceDependencies());
}
