import type {
  CapaImplementationReviewProjectionService,
  CapaImplementationReviewProjectionServiceResult,
} from "../application/capa-implementation-review-projection-service";
import {
  decideCapaImplementationReview,
  type DecideCapaImplementationReviewDependencies,
} from "../application/decide-capa-implementation-review";
import {
  CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
} from "../domain/capa-implementation-review-decision";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  CorrelationId,
  IdempotencyKey,
  RequestId,
  RequestTrace,
} from "../domain/capa-types";
import type {
  CapaApiLogger,
} from "./capa-route-handler";
import {
  SupabaseCapaContextError,
  type CapaRequestContext,
  type SupabaseCapaContextResolver,
  type SupabaseCapaSessionFacts,
} from "../../security/supabase-capa-context";
import {
  SupabaseCapaTenantAccessError,
} from "../../security/supabase-capa-durable-context";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export interface CapaImplementationReviewApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly create_projection_service: (
    context: CapaRequestContext,
  ) => CapaImplementationReviewProjectionService;
  readonly get_decision_dependencies: () => DecideCapaImplementationReviewDependencies;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}

function response(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function normalizedUuid(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function trace(request: Request, generateUuid: () => string): RequestTrace {
  return {
    request_id: (
      normalizedUuid(request.headers.get("x-request-id")) ?? generateUuid()
    ) as RequestId,
    correlation_id: (
      normalizedUuid(request.headers.get("x-correlation-id")) ?? generateUuid()
    ) as CorrelationId,
  };
}

function errorResponse(
  requestTrace: RequestTrace,
  status: number,
  code: string,
  message: string,
): Response {
  return response({
    error: {
      code,
      message,
      correlation_id: requestTrace.correlation_id,
    },
  }, status);
}

function projectionError(
  requestTrace: RequestTrace,
  result: CapaImplementationReviewProjectionServiceResult,
): Response {
  switch (result.status) {
    case "not_found_or_not_authorized":
      return errorResponse(
        requestTrace,
        404,
        "CAPA_IMPLEMENTATION_REVIEW_CASE_NOT_FOUND",
        "The CAPA case was not found.",
      );
    case "wrong_workflow_state":
      return errorResponse(
        requestTrace,
        409,
        "CAPA_IMPLEMENTATION_REVIEW_CASE_STATE_CONFLICT",
        "The CAPA case is not in S90 Implementation Review.",
      );
    case "authorization_denied":
      return errorResponse(
        requestTrace,
        403,
        "CAPA_IMPLEMENTATION_REVIEW_ACCESS_DENIED",
        "The S90 implementation-review operation is not authorized.",
      );
    case "invalid_authoritative_context":
      return errorResponse(
        requestTrace,
        409,
        "CAPA_IMPLEMENTATION_REVIEW_INVALID_AUTHORITATIVE_CONTEXT",
        "The authoritative S90 implementation-review records are inconsistent.",
      );
    case "resolved":
      throw new Error("A resolved projection cannot be mapped as an error.");
  }
}

function decisionError(
  requestTrace: RequestTrace,
  result: Awaited<ReturnType<typeof decideCapaImplementationReview>>,
): Response {
  switch (result.status) {
    case "validation_failed":
      return errorResponse(
        requestTrace,
        400,
        "CAPA_IMPLEMENTATION_REVIEW_VALIDATION_FAILED",
        "The implementation-review request did not pass controlled validation.",
      );
    case "authorization_denied":
      return errorResponse(
        requestTrace,
        403,
        "CAPA_ACCESS_DENIED",
        "The CAPA operation is not authorized.",
      );
    case "step_up_required":
      return errorResponse(
        requestTrace,
        403,
        "CAPA_STEP_UP_REQUIRED",
        "Fresh step-up authentication is required.",
      );
    case "not_found_or_not_authorized":
      return errorResponse(
        requestTrace,
        404,
        "CAPA_NOT_FOUND",
        "The CAPA case was not found.",
      );
    case "idempotency_conflict":
      return errorResponse(
        requestTrace,
        409,
        "CAPA_IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different CAPA request.",
      );
    case "concurrency_conflict":
      return errorResponse(
        requestTrace,
        409,
        "CAPA_CONCURRENCY_CONFLICT",
        "The CAPA record changed before implementation review could be completed.",
      );
    case "workflow_conflict":
      return errorResponse(
        requestTrace,
        409,
        "CAPA_WORKFLOW_CONFLICT",
        "The CAPA case is not available for Implementation Review.",
      );
    case "decided":
    case "already_decided":
      throw new Error("A successful decision cannot be mapped as an error.");
  }
}

async function sessionContext(
  dependencies: CapaImplementationReviewApiDependencies,
  requestTrace: RequestTrace,
): Promise<CapaRequestContext | Response> {
  const facts = await dependencies.get_session_facts();
  if (facts === null) {
    return errorResponse(
      requestTrace,
      401,
      "UNAUTHORIZED",
      "Authentication is required.",
    );
  }
  return dependencies.resolve_context(facts, dependencies.now());
}

function parseDecisionBody(value: unknown): {
  readonly expected_record_version: number;
  readonly expected_current_version_id: CapaCaseVersionId;
  readonly application_body: Readonly<{
    readonly schema_version: typeof CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION;
    readonly source_case_version_id: CapaCaseVersionId;
    readonly implementation_review_baseline_section_version_id: CapaSectionVersionId;
    readonly decision: "accept" | "return";
    readonly rationale: string;
  }>;
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const body = value as Readonly<Record<string, unknown>>;
  const expectedKeys = [
    "decision",
    "expected_current_version_id",
    "expected_record_version",
    "implementation_review_baseline_section_version_id",
    "rationale",
    "schema_version",
    "source_case_version_id",
  ];
  if (
    Object.keys(body).length !== expectedKeys.length ||
    Object.keys(body).sort().join(",") !== expectedKeys.join(",") ||
    !Number.isSafeInteger(body.expected_record_version) ||
    (body.expected_record_version as number) < 1 ||
    typeof body.expected_current_version_id !== "string" ||
    typeof body.source_case_version_id !== "string" ||
    typeof body.implementation_review_baseline_section_version_id !== "string" ||
    body.schema_version !== CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION ||
    (body.decision !== "accept" && body.decision !== "return") ||
    typeof body.rationale !== "string" ||
    body.rationale.length === 0 ||
    body.rationale.trim() !== body.rationale
  ) {
    return null;
  }
  const expectedCurrentVersionId = normalizedUuid(body.expected_current_version_id);
  const sourceCaseVersionId = normalizedUuid(body.source_case_version_id);
  const baselineSectionVersionId = normalizedUuid(
    body.implementation_review_baseline_section_version_id,
  );
  if (
    expectedCurrentVersionId === null ||
    expectedCurrentVersionId !== body.expected_current_version_id ||
    sourceCaseVersionId === null ||
    sourceCaseVersionId !== body.source_case_version_id ||
    baselineSectionVersionId === null ||
    baselineSectionVersionId !== body.implementation_review_baseline_section_version_id
  ) {
    return null;
  }
  return {
    expected_record_version: body.expected_record_version as number,
    expected_current_version_id: expectedCurrentVersionId as CapaCaseVersionId,
    application_body: Object.freeze({
      schema_version: CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
      source_case_version_id: sourceCaseVersionId as CapaCaseVersionId,
      implementation_review_baseline_section_version_id:
        baselineSectionVersionId as CapaSectionVersionId,
      decision: body.decision,
      rationale: body.rationale,
    }),
  };
}

export async function handleCapaImplementationReviewGet(
  request: Request,
  caseId: string,
  dependencies: CapaImplementationReviewApiDependencies,
): Promise<Response> {
  const requestTrace = trace(request, dependencies.generate_uuid);
  try {
    const context = await sessionContext(dependencies, requestTrace);
    if (context instanceof Response) return context;
    const normalizedCaseId = normalizedUuid(caseId);
    if (normalizedCaseId === null || normalizedCaseId !== caseId) {
      return errorResponse(
        requestTrace,
        400,
        "INVALID_CAPA_CASE_ID",
        "A valid CAPA case identifier is required.",
      );
    }
    const result = await dependencies.create_projection_service(context).load({
      capa_case_id: normalizedCaseId as CapaCaseId,
    });
    if (result.status === "resolved") {
      return response({
        projection: result.projection,
        correlation_id: requestTrace.correlation_id,
      }, 200);
    }
    return projectionError(requestTrace, result);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) {
      return errorResponse(
        requestTrace,
        401,
        "INVALID_SESSION_CONTEXT",
        "The authenticated session is not valid for this request.",
      );
    }
    if (error instanceof SupabaseCapaTenantAccessError) {
      return errorResponse(
        requestTrace,
        403,
        "CAPA_TENANT_ACCESS_DENIED",
        "The authenticated user is not authorized to access a CAPA organization.",
      );
    }
    dependencies.logger.error("CAPA API implementation-review projection load failed.", {
      correlation_id: requestTrace.correlation_id,
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      requestTrace,
      500,
      "CAPA_INTERNAL_ERROR",
      "The CAPA implementation-review request could not be completed.",
    );
  }
}

export async function handleCapaImplementationReviewPost(
  request: Request,
  caseId: string,
  dependencies: CapaImplementationReviewApiDependencies,
): Promise<Response> {
  const requestTrace = trace(request, dependencies.generate_uuid);
  try {
    const context = await sessionContext(dependencies, requestTrace);
    if (context instanceof Response) return context;
    const normalizedCaseId = normalizedUuid(caseId);
    if (normalizedCaseId === null || normalizedCaseId !== caseId) {
      return errorResponse(
        requestTrace,
        400,
        "INVALID_CAPA_CASE_ID",
        "A valid CAPA case identifier is required.",
      );
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (
      idempotencyKey === null ||
      idempotencyKey.length === 0 ||
      idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
      idempotencyKey.trim() !== idempotencyKey
    ) {
      return errorResponse(
        requestTrace,
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "A valid idempotency key is required.",
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = await request.json();
    } catch {
      return errorResponse(
        requestTrace,
        400,
        "INVALID_JSON",
        "The request body must be valid JSON.",
      );
    }
    const body = parseDecisionBody(parsedJson);
    if (body === null) {
      return errorResponse(
        requestTrace,
        400,
        "CAPA_IMPLEMENTATION_REVIEW_VALIDATION_FAILED",
        "The implementation-review request did not pass controlled validation.",
      );
    }
    const result = await decideCapaImplementationReview(
      dependencies.get_decision_dependencies(),
      {
        authentication: context.authentication,
        tenant: context.tenant,
        capa_case_id: normalizedCaseId as CapaCaseId,
        expected_record_version: body.expected_record_version,
        expected_current_version_id: body.expected_current_version_id,
        request_trace: {
          ...requestTrace,
          idempotency_key: idempotencyKey as IdempotencyKey,
        },
        body: body.application_body,
      },
    );
    if (result.status === "decided" || result.status === "already_decided") {
      return response({
        status: "decided",
        decision: result.decision,
        capa: {
          capa_case_id: result.capa_case.capa_case_id,
          case_number: result.capa_case.case_number,
          status: result.capa_case.status,
          workflow_state: result.workflow_state,
          record_version: result.capa_case.record_version,
          current_version_id: result.capa_case.current_version_id,
          source_case_version_id: result.source_case_version_id,
          implementation_review_baseline_section_version_id:
            result.implementation_review_baseline_section_version.section_version_id,
          resulting_case_version_id: result.resulting_case_version_id,
        },
        review_decision: {
          schema_version: result.review_decision.schema_version,
          decision: result.review_decision.decision,
          rationale: result.review_decision.rationale,
          reviewer_user_id: result.review_decision.reviewer_user_id,
          decided_at: result.review_decision.decided_at,
        },
        transition_audit_event_id: result.transition_audit_event_id,
        replayed: result.status === "already_decided",
        correlation_id: requestTrace.correlation_id,
      }, 200);
    }
    return decisionError(requestTrace, result);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) {
      return errorResponse(
        requestTrace,
        401,
        "INVALID_SESSION_CONTEXT",
        "The authenticated session is not valid for this request.",
      );
    }
    if (error instanceof SupabaseCapaTenantAccessError) {
      return errorResponse(
        requestTrace,
        403,
        "CAPA_TENANT_ACCESS_DENIED",
        "The authenticated user is not authorized to access a CAPA organization.",
      );
    }
    dependencies.logger.error("CAPA API implementation-review decision failed.", {
      correlation_id: requestTrace.correlation_id,
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      requestTrace,
      500,
      "CAPA_INTERNAL_ERROR",
      "The CAPA implementation-review request could not be completed.",
    );
  }
}
