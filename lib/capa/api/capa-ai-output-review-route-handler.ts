import type {
  CapaCaseId,
  CorrelationId,
  IdempotencyKey,
  RequestId,
  RequestTrace,
} from "../domain/capa-types";

import type {
  CapaIntakeAdvisoryResponse,
} from "../ai/capa-intake-advisory-contract";

import {
  CapaAiOutputReviewValidationError,
  validateCapaAiOutputReviewBrowserRequest,
} from "../ai/capa-ai-output-review-validator";

import type {
  CapaAiOutputReviewService,
} from "../application/capa-ai-output-review-runtime-factory";

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

/**
 * Framework-neutral HTTP boundary for governed human disposition of one
 * immutable CAPA AI intake-advisory output.
 *
 * Browser authority is deliberately narrow:
 *
 * - CAPA case identity and AI-output identity come from the route;
 * - organization and human reviewer identity come from trusted server
 *   context;
 * - authorization policy and persistence are server-controlled;
 * - browser JSON is strictly validated;
 * - Idempotency-Key is mandatory;
 * - this handler cannot perform a CAPA workflow transition or gate approval.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAXIMUM_IDEMPOTENCY_KEY_LENGTH =
  128;

export interface CapaAiOutputReviewApiDependencies {
  readonly get_session_facts:
    () =>
      Promise<
        SupabaseCapaSessionFacts | null
      >;

  readonly resolve_context:
    SupabaseCapaContextResolver;

  readonly create_review_service:
    (
      context:
        CapaRequestContext,
    ) => CapaAiOutputReviewService;

  readonly now:
    () => Date;

  readonly generate_uuid:
    () => string;

  readonly logger:
    CapaApiLogger;
}

function jsonResponse(
  body: unknown,
  status: number,
): Response {
  return Response.json(
    body,
    {
      status,
      headers: {
        "cache-control":
          "no-store",
      },
    },
  );
}

function normalizedUuid(
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }

  const normalized =
    value.trim();

  return UUID_PATTERN.test(
    normalized,
  )
    ? normalized
    : null;
}

function traceIdentifier(
  value: string | null,
  generateUuid: () => string,
): string {
  return (
    normalizedUuid(value) ??
    generateUuid()
  );
}

function baseRequestTrace(
  request: Request,
  generateUuid: () => string,
): {
  readonly request_id:
    RequestId;

  readonly correlation_id:
    CorrelationId;
} {
  return {
    request_id:
      traceIdentifier(
        request.headers.get(
          "x-request-id",
        ),
        generateUuid,
      ) as RequestId,

    correlation_id:
      traceIdentifier(
        request.headers.get(
          "x-correlation-id",
        ),
        generateUuid,
      ) as CorrelationId,
  };
}

function idempotencyKey(
  request: Request,
): IdempotencyKey | null {
  const raw =
    request.headers.get(
      "idempotency-key",
    );

  if (raw === null) {
    return null;
  }

  if (
    raw.length < 1 ||
    raw.length >
      MAXIMUM_IDEMPOTENCY_KEY_LENGTH ||
    raw.trim() !== raw
  ) {
    return null;
  }

  return raw as IdempotencyKey;
}

function errorResponse(
  trace: {
    readonly correlation_id:
      CorrelationId;
  },
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        correlation_id:
          trace.correlation_id,
      },
    },
    status,
  );
}

async function parsedBody(
  request: Request,
): Promise<
  | {
      readonly valid:
        true;

      readonly value:
        unknown;
    }
  | {
      readonly valid:
        false;
    }
> {
  try {
    return {
      valid:
        true,

      value:
        await request.json(),
    };
  } catch {
    return {
      valid:
        false,
    };
  }
}

export async function handleCapaAiOutputReviewPost(
  request: Request,
  caseId: string,
  outputId: string,
  dependencies:
    CapaAiOutputReviewApiDependencies,
): Promise<Response> {
  const baseTrace =
    baseRequestTrace(
      request,
      dependencies.generate_uuid,
    );

  const requestIdempotencyKey =
    idempotencyKey(
      request,
    );

  if (
    requestIdempotencyKey ===
      null
  ) {
    return errorResponse(
      baseTrace,
      400,
      "CAPA_AI_REVIEW_IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
    );
  }

  const trace:
    RequestTrace = {
    request_id:
      baseTrace.request_id,

    correlation_id:
      baseTrace.correlation_id,

    idempotency_key:
      requestIdempotencyKey,
  };

  try {
    const sessionFacts =
      await dependencies
        .get_session_facts();

    if (
      sessionFacts === null
    ) {
      return errorResponse(
        trace,
        401,
        "UNAUTHORIZED",
        "Authentication is required.",
      );
    }

    const context =
      await dependencies
        .resolve_context(
          sessionFacts,
          dependencies.now(),
        );

    const normalizedCaseId =
      normalizedUuid(
        caseId,
      );

    if (
      normalizedCaseId ===
        null ||
      normalizedCaseId !==
        caseId
    ) {
      return errorResponse(
        trace,
        400,
        "INVALID_CAPA_CASE_ID",
        "A valid CAPA case identifier is required.",
      );
    }

    const normalizedOutputId =
      normalizedUuid(
        outputId,
      );

    if (
      normalizedOutputId ===
        null ||
      normalizedOutputId !==
        outputId
    ) {
      return errorResponse(
        trace,
        400,
        "INVALID_CAPA_AI_OUTPUT_ID",
        "A valid CAPA AI-output identifier is required.",
      );
    }

    const body =
      await parsedBody(
        request,
      );

    if (!body.valid) {
      return errorResponse(
        trace,
        400,
        "INVALID_CAPA_AI_OUTPUT_REVIEW",
        "The CAPA AI-output review request is invalid.",
      );
    }

    const reviewRequest =
      validateCapaAiOutputReviewBrowserRequest(
        body.value,
      );

    const result =
      await dependencies
        .create_review_service(
          context,
        )
        .review({
          capa_case_id:
            normalizedCaseId as
              CapaCaseId,

          output_id:
            normalizedOutputId as
              CapaIntakeAdvisoryResponse[
                "output_id"
              ],

          review:
            reviewRequest,

          request_trace:
            trace,
        });

    switch (result.status) {
      case "reviewed":
        return jsonResponse(
          {
            ai_output_review:
              result.review,

            audit_event_id:
              result.audit_event_id,

            replayed:
              false,

            correlation_id:
              trace.correlation_id,
          },
          201,
        );

      case "already_reviewed":
        return jsonResponse(
          {
            ai_output_review:
              result.review,

            audit_event_id:
              result.audit_event_id,

            replayed:
              true,

            correlation_id:
              trace.correlation_id,
          },
          200,
        );

      case "authorization_denied":
        return errorResponse(
          trace,
          403,
          "CAPA_AI_OUTPUT_REVIEW_ACCESS_DENIED",
          "The CAPA AI-output review operation is not authorized.",
        );

      case "output_not_found_or_not_authorized":
        return errorResponse(
          trace,
          404,
          "CAPA_AI_OUTPUT_NOT_FOUND",
          "The CAPA AI output was not found.",
        );

      case "output_not_reviewable":
        return errorResponse(
          trace,
          409,
          "CAPA_AI_OUTPUT_NOT_REVIEWABLE",
          "The CAPA AI output is not reviewable in its current state.",
        );

      case "concurrency_conflict":
        return errorResponse(
          trace,
          409,
          "CAPA_AI_OUTPUT_REVIEW_STALE",
          "The CAPA case changed before the AI-output review could be recorded.",
        );

      case "idempotency_conflict":
        return errorResponse(
          trace,
          409,
          "CAPA_AI_OUTPUT_REVIEW_IDEMPOTENCY_CONFLICT",
          "The Idempotency-Key was already used for a different CAPA AI-output review request.",
        );
    }
  } catch (error) {
    if (
      error instanceof
        SupabaseCapaContextError
    ) {
      return errorResponse(
        trace,
        401,
        "INVALID_SESSION_CONTEXT",
        "The authenticated session is not valid for this request.",
      );
    }

    if (
      error instanceof
        SupabaseCapaTenantAccessError
    ) {
      return errorResponse(
        trace,
        403,
        "CAPA_TENANT_ACCESS_DENIED",
        "The authenticated user is not authorized to access a CAPA organization.",
      );
    }

    if (
      error instanceof
        CapaAiOutputReviewValidationError
    ) {
      return errorResponse(
        trace,
        400,
        "CAPA_AI_OUTPUT_REVIEW_VALIDATION_FAILED",
        "The CAPA AI-output review request is not permitted.",
      );
    }

    dependencies.logger
      .error(
        "CAPA API AI-output review failed.",
        {
          correlation_id:
            trace.correlation_id,

          error_name:
            error instanceof
              Error
              ? error.name
              : "UnknownError",
        },
      );

    return errorResponse(
      trace,
      500,
      "CAPA_INTERNAL_ERROR",
      "The CAPA request could not be completed.",
    );
  }
}
