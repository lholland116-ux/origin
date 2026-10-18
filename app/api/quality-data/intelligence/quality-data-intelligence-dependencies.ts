import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { createCapaApiHandlerDependencies } from "@/app/api/capa/capa-next-route-dependencies";
import { SupabaseQualityDataXlsxApiRateLimiter } from "@/lib/quality-data/quality-data-xlsx-rate-limiter";
import { parseQualityDataAiGate } from "@/lib/quality-data/quality-data-ai-gate";
import { parseQualityDataPilotGate } from "@/lib/quality-data/quality-data-pilot-gate";
import { OpenAIQualityDataAiStructuredModelClient, QUALITY_DATA_AI_TIMEOUT_MS } from "@/lib/quality-data/quality-data-ai-model";
import { writeQualityDataAiTelemetry } from "@/lib/quality-data/quality-data-ai-telemetry";
import type { QualityDataAiApiDependencies } from "@/lib/quality-data/quality-data-ai-api";

export function qualityDataIntelligenceDependencies(): QualityDataAiApiDependencies {
  const capa = createCapaApiHandlerDependencies();
  const aiGate = parseQualityDataAiGate(process.env.QUALITY_DATA_AI_INTERPRETATION_ENABLED, process.env.QUALITY_DATA_AI_ORGANIZATION_IDS);
  return {
    get_session_facts: capa.get_session_facts,
    resolve_context: capa.resolve_context,
    get_control_dependencies() {
      return capa.get_runtime().create_quality_data_stage3a_dependencies?.() ?? null;
    },
    get_stage3d_dependencies() {
      return capa.get_runtime().create_quality_data_stage3d_dependencies?.() ?? null;
    },
    get_ai_dependencies() {
      if (aiGate.status !== "enabled") return null;
      const apiKey = process.env.OPENAI_API_KEY;
      if (typeof apiKey !== "string" || apiKey.trim().length === 0) return null;
      const qualityData = capa.get_runtime().create_quality_data_stage3a_dependencies?.() ?? null;
      if (!qualityData) return null;
      return {
        quality_data: qualityData,
        model_client: new OpenAIQualityDataAiStructuredModelClient(new OpenAI({ apiKey, maxRetries: 0, timeout: QUALITY_DATA_AI_TIMEOUT_MS })),
        generate_handle: randomUUID,
        record_telemetry: writeQualityDataAiTelemetry,
      };
    },
    now: capa.now,
    generate_uuid: randomUUID,
    configured_app_url: process.env.NEXT_PUBLIC_APP_URL,
    quality_data_pilot_gate: parseQualityDataPilotGate(process.env.QUALITY_DATA_INGESTION_PILOT_ENABLED, process.env.QUALITY_DATA_INGESTION_PILOT_ORGANIZATION_IDS),
    ai_gate: aiGate,
    rate_limiter: new SupabaseQualityDataXlsxApiRateLimiter(),
  };
}
