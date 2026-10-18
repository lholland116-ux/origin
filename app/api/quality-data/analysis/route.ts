import { createCapaApiHandlerDependencies } from "@/app/api/capa/capa-next-route-dependencies";
import { handleQualityDataAnalysisPost, type QualityDataStage3AApiDependencies } from "@/lib/quality-data/quality-data-stage3a-api";
import { parseQualityDataPilotGate } from "@/lib/quality-data/quality-data-pilot-gate";
import { SupabaseQualityDataXlsxApiRateLimiter } from "@/lib/quality-data/quality-data-xlsx-rate-limiter";

export const runtime = "nodejs";
export const maxDuration = 30;

function dependencies(): QualityDataStage3AApiDependencies {
  const capa = createCapaApiHandlerDependencies();
  return {
    get_session_facts: capa.get_session_facts,
    resolve_context: capa.resolve_context,
    get_service_dependencies() {
      const factory = capa.get_runtime().create_quality_data_stage3a_dependencies;
      return factory?.() ?? null;
    },
    now: capa.now,
    generate_uuid: capa.generate_uuid,
    configured_app_url: process.env.NEXT_PUBLIC_APP_URL,
    pilot_gate: parseQualityDataPilotGate(
      process.env.QUALITY_DATA_INGESTION_PILOT_ENABLED,
      process.env.QUALITY_DATA_INGESTION_PILOT_ORGANIZATION_IDS,
    ),
    rate_limiter: new SupabaseQualityDataXlsxApiRateLimiter(),
  };
}

export async function POST(request: Request): Promise<Response> {
  return handleQualityDataAnalysisPost(request, dependencies());
}
