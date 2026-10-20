import { handleQualityDataDeterministicIntelligencePost } from "@/lib/quality-data/quality-data-ai-api";
import { qualityDataIntelligenceDependencies } from "../quality-data-intelligence-dependencies";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleQualityDataDeterministicIntelligencePost(request, qualityDataIntelligenceDependencies());
}
