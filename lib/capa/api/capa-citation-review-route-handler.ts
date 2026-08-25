import type {
  CorrelationId,
  IdempotencyKey,
  RequestId,
  RequestTrace,
} from "../domain/capa-types";

import type {
  CapaKnowledgeCitationId,
} from "../knowledge/capa-knowledge-retrieval-contract";

import {
  CAPA_KNOWLEDGE_CITATION_REVIEW_DISPOSITIONS,
  type CapaKnowledgeCitationReviewDisposition,
} from "../knowledge/capa-knowledge-citation-review-contract";

import {
  CapaKnowledgeCitationReviewServiceError,
  type CapaKnowledgeCitationReviewService,
} from "../knowledge/capa-knowledge-citation-review-service";

import {
  CapaKnowledgeCitationReviewValidationError,
} from "../knowledge/capa-knowledge-citation-review-validator";

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
const DISPOSITIONS = new Set<string>(
  CAPA_KNOWLEDGE_CITATION_REVIEW_DISPOSITIONS,
);

export interface CapaCitationReviewApiDependencies {
  readonly get_session_facts:
    () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly create_review_service:
    (context: CapaRequestContext) => CapaKnowledgeCitationReviewService;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}

interface ParsedReviewBody {
  readonly disposition: CapaKnowledgeCitationReviewDisposition;
  readonly rationale: string;
}

function jsonResponse(body: unknown, status: number): Response {
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

function traceIdentifier(
  value: string | null,
  generateUuid: () => string,
): string {
  return normalizedUuid(value) ?? generateUuid();
}

function requestTrace(
  request: Request,
  generateUuid: () => string,
): RequestTrace {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  return {
    request_id: traceIdentifier(
      request.headers.get("x-request-id"),
      generateUuid,
    ) as RequestId,
    correlation_id: traceIdentifier(
      request.headers.get("x-correlation-id"),
      generateUuid,
    ) as CorrelationId,
    idempotency_key: (
      key.length > 0 && key.length <= MAX_IDEMPOTENCY_KEY_LENGTH
        ? key
        : generateUuid()
    ) as IdempotencyKey,
  };
}

function errorResponse(
  trace: RequestTrace,
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse({
    error: {
      code,
      message,
      correlation_id: trace.correlation_id,
    },
  }, status);
}

async function parseReviewBody(request: Request): Promise<ParsedReviewBody | null> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const body = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(body).length !== 2 ||
    typeof body.disposition !== "string" ||
    !DISPOSITIONS.has(body.disposition) ||
    typeof body.rationale !== "string"
  ) {
    return null;
  }
  return {
    disposition: body.disposition as CapaKnowledgeCitationReviewDisposition,
    rationale: body.rationale,
  };
}

export async function handleCapaCitationReviewPost(
  request: Request,
  citationId: string,
  dependencies: CapaCitationReviewApiDependencies,
): Promise<Response> {
  const trace = requestTrace(request, dependencies.generate_uuid);

  try {
    const facts = await dependencies.get_session_facts();
    if (facts === null) {
      return errorResponse(trace, 401, "UNAUTHORIZED", "Authentication is required.");
    }
    const context = await dependencies.resolve_context(facts, dependencies.now());
    const normalizedCitationId = normalizedUuid(citationId);
    if (normalizedCitationId === null || normalizedCitationId !== citationId) {
      return errorResponse(
        trace,
        400,
        "INVALID_CAPA_CITATION_ID",
        "A valid CAPA citation identifier is required.",
      );
    }
    const body = await parseReviewBody(request);
    if (body === null) {
      return errorResponse(
        trace,
        400,
        "INVALID_CAPA_CITATION_REVIEW",
        "The CAPA citation-review request is invalid.",
      );
    }

    const result = await dependencies.create_review_service(context)
      .submitHumanReview({
        organization_id: context.tenant.organization_id,
        citation_id: normalizedCitationId as CapaKnowledgeCitationId,
        disposition: body.disposition,
        rationale: body.rationale,
        reviewed_by: {
          actor_type: "human",
          actor_id: context.owner_user_id,
        },
        request_trace: trace,
      });

    return jsonResponse({
      citation_review: result.review,
      replayed: result.status === "already_recorded",
      correlation_id: trace.correlation_id,
    }, result.status === "recorded" ? 201 : 200);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) {
      return errorResponse(
        trace,
        401,
        "INVALID_SESSION_CONTEXT",
        "The authenticated session is not valid for this request.",
      );
    }
    if (error instanceof SupabaseCapaTenantAccessError) {
      return errorResponse(
        trace,
        403,
        "CAPA_TENANT_ACCESS_DENIED",
        "The authenticated user is not authorized to access a CAPA organization.",
      );
    }
    if (error instanceof CapaKnowledgeCitationReviewValidationError) {
      return errorResponse(
        trace,
        400,
        "CAPA_CITATION_REVIEW_VALIDATION_FAILED",
        "The CAPA citation-review request is not permitted.",
      );
    }
    if (error instanceof CapaKnowledgeCitationReviewServiceError) {
      if (error.reason_code === "HUMAN_REVIEW_NOT_AUTHORIZED") {
        return errorResponse(
          trace,
          403,
          "CAPA_CITATION_REVIEW_ACCESS_DENIED",
          "The CAPA citation-review operation is not authorized.",
        );
      }
      if (
        error.reason_code === "CITATION_NOT_FOUND_OR_NOT_AUTHORIZED" ||
        error.reason_code === "SOURCE_STATUS_NOT_FOUND_OR_NOT_AUTHORIZED"
      ) {
        return errorResponse(
          trace,
          404,
          "CAPA_CITATION_NOT_FOUND",
          "The CAPA citation was not found.",
        );
      }
      if (error.reason_code === "CITATION_REVIEW_CONFLICT") {
        return errorResponse(
          trace,
          409,
          "CAPA_CITATION_REVIEW_CONFLICT",
          "The CAPA citation review conflicts with an existing record.",
        );
      }
    }

    dependencies.logger.error("CAPA API citation review failed.", {
      correlation_id: trace.correlation_id,
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      trace,
      500,
      "CAPA_INTERNAL_ERROR",
      "The CAPA request could not be completed.",
    );
  }
}
