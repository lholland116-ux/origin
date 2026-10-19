import { handleQualityDataCapaDraftHandoffPost } from "@/lib/quality-data/quality-data-ai-api";
import { qualityDataIntelligenceDependencies } from "../../quality-data-intelligence-dependencies";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, context: { readonly params: Promise<{ readonly reportId: string }> }): Promise<Response> {
  const params = await context.params;
  return handleQualityDataCapaDraftHandoffPost(request, params.reportId, qualityDataIntelligenceDependencies());
}
