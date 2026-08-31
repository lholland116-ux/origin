import type { CapaApiHandlerDependencies } from "./capa-route-handler";
import { CAPA_INVESTIGATION_OWNER_PURPOSE } from "../participants/capa-investigation-owner-eligibility";
import { getActiveRoleAssignments } from "../../security/tenant-context";
import { isSessionActive } from "../../security/auth-context";
import { SupabaseCapaContextError } from "../../security/supabase-capa-context";
import { SupabaseCapaTenantAccessError } from "../../security/supabase-capa-durable-context";

export type CapaParticipantsApiDependencies = CapaApiHandlerDependencies;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function error(correlationId: string, status: number, code: string, message: string) {
  return json({ error: { code, message, correlation_id: correlationId } }, status);
}

export async function handleCapaParticipantsGet(
  request: Request,
  dependencies: CapaParticipantsApiDependencies,
): Promise<Response> {
  const correlationHeader = request.headers.get("x-correlation-id");
  const correlationId = correlationHeader !== null && UUID_PATTERN.test(correlationHeader)
    ? correlationHeader
    : dependencies.generate_uuid();
  try {
    const url = new URL(request.url);
    const keys = [...url.searchParams.keys()];
    const purposes = url.searchParams.getAll("purpose");
    if (keys.some((key) => key !== "purpose") || purposes.length !== 1 ||
      purposes[0] !== CAPA_INVESTIGATION_OWNER_PURPOSE) {
      return error(correlationId, 400, "INVALID_CAPA_PARTICIPANT_QUERY",
        "Only purpose=investigation_owner is supported.");
    }

    const facts = await dependencies.get_session_facts();
    if (facts === null) return error(correlationId, 401, "UNAUTHORIZED", "Authentication is required.");
    const trustedNow = dependencies.now();
    const context = await dependencies.resolve_context(facts, trustedNow);
    const eligibleCaller = context.authentication.principal.principal_type === "human" &&
      isSessionActive(context.authentication, trustedNow) &&
      getActiveRoleAssignments(context.tenant, trustedNow).some((assignment) =>
        assignment.scope === "ORGANIZATION" &&
        (assignment.role_id === "CAPA_OWNER" || assignment.role_id === "CAPA_CONTRIBUTOR"));
    if (!eligibleCaller) {
      return error(correlationId, 403, "CAPA_PARTICIPANT_DIRECTORY_ACCESS_DENIED",
        "The participant directory is not authorized for this request.");
    }

    const participants = await dependencies.get_runtime()
      .participant_eligibility_repository
      .listEligibleInvestigationOwners(context.tenant.organization_id, trustedNow);
    return json({ purpose: CAPA_INVESTIGATION_OWNER_PURPOSE, participants, correlation_id: correlationId });
  } catch (caught) {
    if (caught instanceof SupabaseCapaContextError) {
      return error(correlationId, 401, "INVALID_SESSION_CONTEXT",
        "The authenticated session is not valid for this request.");
    }
    if (caught instanceof SupabaseCapaTenantAccessError) {
      dependencies.logger.error("CAPA participant directory tenant resolution denied.", {
        correlation_id: correlationId, error_name: caught.name, reason_code: caught.reason_code,
      });
      return error(correlationId, 403, "CAPA_TENANT_ACCESS_DENIED",
        "The authenticated user is not authorized to access a CAPA organization.");
    }
    dependencies.logger.error("CAPA participant directory failed.", {
      correlation_id: correlationId,
      error_name: caught instanceof Error ? caught.name : "UnknownError",
    });
    return error(correlationId, 500, "CAPA_INTERNAL_ERROR", "The CAPA request could not be completed.");
  }
}
