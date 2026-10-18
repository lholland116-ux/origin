import { createHash } from "node:crypto";
import type { RequestTrace } from "../capa/domain/capa-types";
import type { TransactionContext } from "../database/transactions";
import type { CapaRequestContext } from "../security/supabase-capa-context";
import { isHumanPrincipal, isSessionActive } from "../security/auth-context";
import type { QualityDataStage3AServiceDependencies } from "./quality-data-stage3a-service";
import { qualityDataExternalAiOptInCommandSchema, QUALITY_DATA_EXTERNAL_AI_OPT_IN_VERSION, type QualityDataExternalAiOptInCommand, type QualityDataExternalAiOptInState } from "./quality-data-ai-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type QualityDataExternalAiOptInResult =
  | { readonly status: "applied" | "already_recorded"; readonly state: QualityDataExternalAiOptInState }
  | { readonly status: "found"; readonly state: QualityDataExternalAiOptInState | null }
  | { readonly status: "invalid_request" }
  | { readonly status: "denied" }
  | { readonly status: "conflict"; readonly reason_code: "IDEMPOTENCY_KEY_REQUIRED" | "IDEMPOTENCY_KEY_REUSED" | "STALE_TRANSITION" }
  | { readonly status: "unavailable" };

function validContext(context: CapaRequestContext, now: Date): boolean {
  return Number.isFinite(now.getTime()) && isHumanPrincipal(context.authentication) && isSessionActive(context.authentication, now)
    && context.owner_user_id === context.authentication.principal.user_id
    && UUID.test(context.tenant.organization_id) && UUID.test(context.authentication.principal.user_id)
    && UUID.test(context.tenant.access_grant_id);
}

async function authorizeTransfer(dependencies: QualityDataStage3AServiceDependencies, context: CapaRequestContext, now: Date): Promise<boolean> {
  if (!dependencies.external_ai_transfer_authorizer) return false;
  try { return (await dependencies.external_ai_transfer_authorizer.authorizeExternalAiTransfer(context, now)).allowed; }
  catch { return false; }
}

export async function transitionQualityDataExternalAiOptIn(
  dependencies: QualityDataStage3AServiceDependencies,
  context: CapaRequestContext,
  requestTrace: RequestTrace,
  input: unknown,
): Promise<QualityDataExternalAiOptInResult> {
  const now = dependencies.clock.now();
  if (!validContext(context, now)) return { status: "invalid_request" };
  if (!isHumanPrincipal(context.authentication)) return { status: "invalid_request" };
  const actorUserId = context.authentication.principal.user_id;
  if (!await authorizeTransfer(dependencies, context, now)) return { status: "denied" };
  const parsed = qualityDataExternalAiOptInCommandSchema.safeParse(input);
  if (!parsed.success || parsed.data.schema_version !== QUALITY_DATA_EXTERNAL_AI_OPT_IN_VERSION) return { status: "invalid_request" };
  if (!requestTrace.idempotency_key || requestTrace.idempotency_key.length > 200) return { status: "conflict", reason_code: "IDEMPOTENCY_KEY_REQUIRED" };
  const append = dependencies.repository.appendExternalAiOptInEvent;
  if (!append) return { status: "unavailable" };
  const command: QualityDataExternalAiOptInCommand = parsed.data;
  const request_fingerprint = createHash("sha256").update(JSON.stringify({ organization_id: context.tenant.organization_id, command })).digest("hex");
  try {
    return await dependencies.transaction_manager.runInTransaction(requestTrace, async (transaction: TransactionContext) => {
      const result = await append.call(dependencies.repository, transaction, {
        organization_id: context.tenant.organization_id,
        actor_user_id: actorUserId,
        actor_membership_id: context.tenant.access_grant_id,
        request_trace: { ...requestTrace, idempotency_key: requestTrace.idempotency_key! },
        command,
        event_id: dependencies.ids.uuid(),
        request_fingerprint,
        now: now.toISOString(),
      });
      if (result.status === "unauthorized") return { status: "denied" as const };
      if (result.status === "conflict") return { status: "conflict" as const, reason_code: result.reason_code };
      return { status: result.status, state: result.state };
    });
  } catch { return { status: "unavailable" }; }
}

export async function getQualityDataExternalAiOptIn(
  dependencies: QualityDataStage3AServiceDependencies,
  context: CapaRequestContext,
): Promise<QualityDataExternalAiOptInResult> {
  const now = dependencies.clock.now();
  if (!validContext(context, now)) return { status: "invalid_request" };
  if (!await authorizeTransfer(dependencies, context, now)) return { status: "denied" };
  const findState = dependencies.repository.findExternalAiOptInState;
  if (!findState) return { status: "unavailable" };
  try {
    const state = await findState.call(dependencies.repository, context.tenant.organization_id);
    if (state && state.organization_id !== context.tenant.organization_id) return { status: "unavailable" };
    return { status: "found", state };
  } catch { return { status: "unavailable" }; }
}
