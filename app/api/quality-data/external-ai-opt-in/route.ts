import { createCapaApiHandlerDependencies } from "@/app/api/capa/capa-next-route-dependencies";
import { SupabaseQualityDataXlsxApiRateLimiter } from "@/lib/quality-data/quality-data-xlsx-rate-limiter";
import { parseQualityDataPilotGate } from "@/lib/quality-data/quality-data-pilot-gate";
import { handleQualityDataExternalAiOptInGet, handleQualityDataExternalAiOptInPost, type QualityDataAiApiDependencies } from "@/lib/quality-data/quality-data-ai-api";

export const runtime = "nodejs";
export const maxDuration = 15;

function dependencies(): QualityDataAiApiDependencies {
  const capa = createCapaApiHandlerDependencies();
  return {
    get_session_facts: capa.get_session_facts,
    resolve_context: capa.resolve_context,
    get_control_dependencies() {
      return capa.get_runtime().create_quality_data_stage3a_dependencies?.() ?? null;
    },
    get_ai_dependencies: () => null,
    now: capa.now,
    generate_uuid: capa.generate_uuid,
    configured_app_url: process.env.NEXT_PUBLIC_APP_URL,
    quality_data_pilot_gate: parseQualityDataPilotGate(process.env.QUALITY_DATA_INGESTION_PILOT_ENABLED, process.env.QUALITY_DATA_INGESTION_PILOT_ORGANIZATION_IDS),
    rate_limiter: new SupabaseQualityDataXlsxApiRateLimiter(),
  };
}

export async function GET(request: Request): Promise<Response> {
  return handleQualityDataExternalAiOptInGet(request, dependencies());
}

export async function POST(request: Request): Promise<Response> {
  return handleQualityDataExternalAiOptInPost(request, dependencies());
}
