import { estimateAiTelemetryCost, type AiTelemetryCostResult } from "../ai/telemetry-pricing";
import { mapOpenAIResponseUsage, type OpenAIResponseUsage } from "../ai/request-telemetry";
import type { RequestTrace } from "../capa/domain/capa-types";
import type { QualityDataReadScope } from "../database/repositories/quality-data-repository";
import type { CapaRequestContext } from "../security/supabase-capa-context";
import { isHumanPrincipal, isSessionActive } from "../security/auth-context";
import { QUALITY_ANALYSIS_REQUEST_VERSION, type QualityAnalysisResult } from "./quality-analysis-contract";
import { analyzeQualityDatasetVersion, detectQualityDatasetSignals, type QualityDataStage3AServiceDependencies } from "./quality-data-stage3a-service";
import { QUALITY_SIGNAL_REQUEST_VERSION, qualitySignalDetectionRequestSchema, type QualitySignalDetectionResult } from "./quality-signal-contract";
import { buildQualityDataAiPrompt, QUALITY_DATA_AI_MAX_ESTIMATED_COST_NANO_USD, QUALITY_DATA_AI_MODEL, QUALITY_DATA_AI_OUTPUT_TOKEN_LIMIT, type QualityDataAiStructuredModelClient } from "./quality-data-ai-model";
import { QUALITY_DATA_AI_ANALYSIS_REQUEST_VERSION, type QualityDataAiAnalysisResult, type QualityEvidencePacket } from "./quality-data-ai-contract";
import { buildQualityEvidencePacket, validateModelEvidenceReferences } from "./quality-data-evidence-packet";
import { qualityDataAiAnalysisRequestSchema } from "./quality-data-ai-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type QualityDataAiTelemetryRecord = {
  readonly request_id: string;
  readonly correlation_id: string;
  readonly model: typeof QUALITY_DATA_AI_MODEL;
  readonly outcome: "success" | "provider_error" | "invalid_output" | "cost_unavailable";
  readonly latency_ms: number;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
  readonly estimated_cost_nano_usd: string | null;
  readonly pricing_version: string | null;
};

export interface QualityDataAiInterpretationDependencies {
  readonly quality_data: QualityDataStage3AServiceDependencies;
  readonly model_client: QualityDataAiStructuredModelClient;
  readonly generate_handle: () => string;
  readonly record_telemetry: (record: QualityDataAiTelemetryRecord) => Promise<void>;
}

export type QualityDataAiInterpretationResult =
  | { readonly status: "complete"; readonly result: QualityDataAiAnalysisResult }
  | { readonly status: "invalid_request" | "denied" | "not_found_or_not_authorized" | "not_approved" | "unavailable" | "rate_limit_required" | "evidence_invalid" | "provider_error" | "invalid_model_output" | "cost_unavailable" };

function validContext(context: CapaRequestContext, now: Date): boolean {
  return Number.isFinite(now.getTime()) && isHumanPrincipal(context.authentication) && isSessionActive(context.authentication, now)
    && context.owner_user_id === context.authentication.principal.user_id
    && UUID.test(context.tenant.organization_id) && UUID.test(context.authentication.principal.user_id);
}

async function externalAiEnabled(dependencies: QualityDataStage3AServiceDependencies, context: CapaRequestContext, now: Date): Promise<boolean> {
  if (!dependencies.external_ai_transfer_authorizer) return false;
  try {
    const authorization = await dependencies.external_ai_transfer_authorizer.authorizeExternalAiTransfer(context, now);
    if (!authorization.allowed || authorization.organization_id !== context.tenant.organization_id) return false;
    const state = await dependencies.repository.findExternalAiOptInState?.(context.tenant.organization_id);
    return state?.organization_id === context.tenant.organization_id && state.decision === "enabled";
  } catch { return false; }
}

function costResult(input: { inputTokens: number; outputTokens: number; now: Date }): AiTelemetryCostResult {
  return estimateAiTelemetryCost({ provider: "openai", model: QUALITY_DATA_AI_MODEL, occurredAt: input.now,
    inputTokens: input.inputTokens, cachedInputTokens: 0, outputTokens: input.outputTokens, webSearchCalls: 0 });
}

function requestScope(context: CapaRequestContext, authorization: Extract<Awaited<ReturnType<QualityDataStage3AServiceDependencies["authorizer"]["authorizeRead"]>>, { allowed: true }>, now: Date): QualityDataReadScope {
  return { organization_id: context.tenant.organization_id, user_id: authorization.uploader_user_id,
    membership_id: authorization.membership_id, now: now.toISOString() };
}

export async function interpretQualityDataAnalysis(
  dependencies: QualityDataAiInterpretationDependencies,
  context: CapaRequestContext,
  requestTrace: RequestTrace,
  input: unknown,
): Promise<QualityDataAiInterpretationResult> {
  const now = dependencies.quality_data.clock.now();
  if (!validContext(context, now) || !UUID.test(requestTrace.request_id) || !UUID.test(requestTrace.correlation_id)) return { status: "invalid_request" };
  const read = await dependencies.quality_data.authorizer.authorizeRead(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const }));
  if (!read.allowed || read.organization_id !== context.tenant.organization_id) return { status: "denied" };
  if (!await externalAiEnabled(dependencies.quality_data, context, now)) return { status: "denied" };
  const parsed = qualityDataAiAnalysisRequestSchema.safeParse(input);
  if (!parsed.success || parsed.data.schema_version !== QUALITY_DATA_AI_ANALYSIS_REQUEST_VERSION) return { status: "invalid_request" };
  const signalsParsed = qualitySignalDetectionRequestSchema.safeParse({
    schema_version: QUALITY_SIGNAL_REQUEST_VERSION,
    dataset_version_id: parsed.data.dataset_version_id,
    signals: parsed.data.signals,
  });
  if (!signalsParsed.success || parsed.data.metrics.length < 1) return { status: "invalid_request" };
  const calculations = await analyzeQualityDatasetVersion(dependencies.quality_data, context, {
    schema_version: QUALITY_ANALYSIS_REQUEST_VERSION, dataset_version_id: parsed.data.dataset_version_id,
    time_window: { kind: "all_records_in_dataset_version" }, metrics: parsed.data.metrics,
  });
  if (calculations.status === "denied") return { status: "denied" };
  if (calculations.status === "not_found_or_not_authorized") return { status: "not_found_or_not_authorized" };
  if (calculations.status === "not_approved") return { status: "not_approved" };
  if (calculations.status === "invalid_request" || calculations.status === "calculation_error") return { status: "evidence_invalid" };
  const detection = await detectQualityDatasetSignals(dependencies.quality_data, context, signalsParsed.data);
  if (detection.status === "denied") return { status: "denied" };
  if (detection.status === "not_found_or_not_authorized") return { status: "not_found_or_not_authorized" };
  if (detection.status === "not_approved") return { status: "not_approved" };
  if (detection.status === "invalid_request" || detection.status === "calculation_error") return { status: "evidence_invalid" };
  const analysis: QualityAnalysisResult = calculations.result;
  const signalResult: QualitySignalDetectionResult = detection.result;
  const built = buildQualityEvidencePacket(analysis, signalResult, dependencies.generate_handle);
  if (!built) return { status: "evidence_invalid" };
  const packet: QualityEvidencePacket = built.packet;
  let prompt: string;
  try { prompt = buildQualityDataAiPrompt(packet); } catch { return { status: "evidence_invalid" }; }
  // A byte-per-token upper bound is intentionally conservative for this
  // bounded ASCII-heavy JSON packet and keeps preflight cost below the cap.
  const estimatedInputTokens = Buffer.byteLength(prompt, "utf8");
  const upperCost = costResult({ inputTokens: estimatedInputTokens, outputTokens: QUALITY_DATA_AI_OUTPUT_TOKEN_LIMIT, now });
  if (!upperCost.available || upperCost.nanoUsd > QUALITY_DATA_AI_MAX_ESTIMATED_COST_NANO_USD) return { status: "cost_unavailable" };
  // Recheck provider-transfer opt-in and exact approved version immediately before external dispatch.
  if (!await externalAiEnabled(dependencies.quality_data, context, dependencies.quality_data.clock.now())) return { status: "denied" };
  const currentApproval = await dependencies.quality_data.repository.findApprovedDatasetVersion(
    requestScope(context, read, dependencies.quality_data.clock.now()), parsed.data.dataset_version_id,
  ).catch(() => null);
  if (!currentApproval || currentApproval.status !== "approved"
    || currentApproval.approval.approval_event_id !== analysis.approval.approval_event_id) return { status: "not_approved" };

  const started = Date.now();
  let telemetry: QualityDataAiTelemetryRecord = {
    request_id: requestTrace.request_id, correlation_id: requestTrace.correlation_id, model: QUALITY_DATA_AI_MODEL,
    outcome: "provider_error", latency_ms: 0, input_tokens: null, output_tokens: null, total_tokens: null,
    estimated_cost_nano_usd: null, pricing_version: null,
  };
  const recordTelemetry = async () => { try { await dependencies.record_telemetry(telemetry); } catch { /* telemetry cannot alter analysis outcome */ } };
  let raw: Awaited<ReturnType<QualityDataAiStructuredModelClientGenerate>>;
  try {
    raw = await dependencies.model_client.generate(packet);
  } catch {
    telemetry = { ...telemetry, latency_ms: Math.max(0, Date.now() - started), outcome: "provider_error" };
    await recordTelemetry();
    return { status: "provider_error" };
  }
  telemetry = { ...telemetry, latency_ms: Math.min(60_000, Math.max(0, Date.now() - started)) };
  let modelOutput: unknown;
  try { modelOutput = JSON.parse(raw.output_text); }
  catch { telemetry = { ...telemetry, outcome: "invalid_output" }; await recordTelemetry(); return { status: "invalid_model_output" }; }
  const validated = validateModelEvidenceReferences(modelOutput, built.citations);
  if (!validated.valid) { telemetry = { ...telemetry, outcome: "invalid_output" }; await recordTelemetry(); return { status: "invalid_model_output" }; }
  const usage = mapOpenAIResponseUsage(raw.usage as OpenAIResponseUsage | undefined);
  if (usage.inputTokens === null || usage.outputTokens === null || usage.totalTokens === null
    || usage.inputTokens > estimatedInputTokens + 1024 || usage.outputTokens > QUALITY_DATA_AI_OUTPUT_TOKEN_LIMIT) {
    telemetry = { ...telemetry, outcome: "cost_unavailable", input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.totalTokens };
    await recordTelemetry(); return { status: "cost_unavailable" };
  }
  const actualCost = costResult({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, now: dependencies.quality_data.clock.now() });
  if (!actualCost.available || actualCost.nanoUsd > QUALITY_DATA_AI_MAX_ESTIMATED_COST_NANO_USD) {
    telemetry = { ...telemetry, outcome: "cost_unavailable", input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.totalTokens };
    await recordTelemetry(); return { status: "cost_unavailable" };
  }
  telemetry = { ...telemetry, outcome: "success", input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.totalTokens,
    estimated_cost_nano_usd: actualCost.nanoUsd.toString(), pricing_version: actualCost.pricingVersion };
  await recordTelemetry();
  // A revocation during the model call prevents returning an interpretation.
  if (!await externalAiEnabled(dependencies.quality_data, context, dependencies.quality_data.clock.now())) return { status: "denied" };
  const finalApproval = await dependencies.quality_data.repository.findApprovedDatasetVersion(
    requestScope(context, read, dependencies.quality_data.clock.now()), parsed.data.dataset_version_id,
  ).catch(() => null);
  if (!finalApproval || finalApproval.status !== "approved" || finalApproval.approval.approval_event_id !== analysis.approval.approval_event_id) return { status: "not_approved" };

  return {
    status: "complete",
    result: {
      schema_version: "quality-data-ai-analysis-result-1.0.0", packet_version: packet.schema_version,
      status: "complete", verified_calculations: packet.calculations, observed_signals: packet.signals,
      time_windows: packet.time_windows, assumptions: packet.assumptions,
      data_quality_limitations: packet.data_quality_limitations, interpretation: validated.output,
      interpretation_status: "unverified_advisory_hypotheses", source_verification: "not_asserted",
      authorization_scope: "analytical_use_only", evidence_citations: validated.citations,
    },
  };
}

type QualityDataAiStructuredModelClientGenerate = import("./quality-data-ai-model").QualityDataAiStructuredModelClient["generate"];
