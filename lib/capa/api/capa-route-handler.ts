import type {
  CapaCaseId,
  CorrelationId,
  IdempotencyKey,
  RequestId,
  RequestTrace,
} from "../domain/capa-types";

import {
  createCapa,
} from "../application/create-capa";

import type {
  CapaDevelopmentRuntime,
} from "../application/capa-development-runtime";

import {
  resolveDevelopmentCapaRequestContext,
  SupabaseCapaContextError,
  type SupabaseCapaSessionFacts,
} from "../../security/supabase-capa-context";

/**
 * Framework-neutral HTTP handler for the first CAPA development API.
 *
 * The Next.js route supplies server-verified Supabase session facts.
 * This module owns request tracing, safe request parsing, application
 * orchestration and controlled response mapping.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export interface CapaApiLogger {
  error(
    message: string,
    metadata?: Readonly<
      Record<string, unknown>
    >,
  ): void;
}

export interface CapaApiHandlerDependencies {
  readonly get_session_facts:
    () =>
      Promise<
        SupabaseCapaSessionFacts | null
      >;

  readonly get_runtime:
    () => CapaDevelopmentRuntime;

  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}

interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlation_id:
      CorrelationId;
    readonly issues?: readonly {
      readonly path: string;
      readonly message: string;
    }[];
  };
}

function jsonResponse(
  body: unknown,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function normalizedUuid(
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  return UUID_PATTERN.test(normalized)
    ? normalized
    : null;
}

function traceIdentifier(
  headerValue: string | null,
  generateUuid: () => string,
): string {
  return (
    normalizedUuid(headerValue) ??
    generateUuid()
  );
}

function idempotencyKey(
  headerValue: string | null,
  generateUuid: () => string,
): IdempotencyKey {
  const normalized =
    headerValue?.trim() ?? "";

  if (
    normalized.length > 0 &&
    normalized.length <=
      MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    return normalized as IdempotencyKey;
  }

  return generateUuid() as IdempotencyKey;
}

function requestTrace(
  request: Request,
  generateUuid: () => string,
): RequestTrace {
  return {
    request_id: traceIdentifier(
      request.headers.get("x-request-id"),
      generateUuid,
    ) as RequestId,

    correlation_id: traceIdentifier(
      request.headers.get(
        "x-correlation-id",
      ),
      generateUuid,
    ) as CorrelationId,

    idempotency_key: idempotencyKey(
      request.headers.get(
        "idempotency-key",
      ),
      generateUuid,
    ),
  };
}

function errorResponse(
  trace: RequestTrace,
  status: number,
  code: string,
  message: string,
  issues?: ErrorResponseBody["error"]["issues"],
): Response {
  const body: ErrorResponseBody = {
    error: {
      code,
      message,
      correlation_id:
        trace.correlation_id,
      ...(issues === undefined
        ? {}
        : { issues }),
    },
  };

  return jsonResponse(body, status);
}

async function authenticatedContext(
  dependencies:
    CapaApiHandlerDependencies,
):
  Promise<
    | ReturnType<
        typeof resolveDevelopmentCapaRequestContext
      >
    | null
  > {
  const sessionFacts =
    await dependencies.get_session_facts();

  if (sessionFacts === null) {
    return null;
  }

  return resolveDevelopmentCapaRequestContext(
    sessionFacts,
    dependencies.now(),
  );
}

async function parseJsonBody(
  request: Request,
): Promise<
  | {
      readonly valid: true;
      readonly body: unknown;
    }
  | {
      readonly valid: false;
    }
> {
  try {
    return {
      valid: true,
      body: await request.json(),
    };
  } catch {
    return {
      valid: false,
    };
  }
}

function safeUnexpectedError(
  dependencies:
    CapaApiHandlerDependencies,
  trace: RequestTrace,
  operation: string,
  error: unknown,
): Response {
  dependencies.logger.error(
    `CAPA API ${operation} failed.`,
    {
      correlation_id:
        trace.correlation_id,
      error_name:
        error instanceof Error
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

export async function handleCapaPost(
  request: Request,
  dependencies:
    CapaApiHandlerDependencies,
): Promise<Response> {
  const trace = requestTrace(
    request,
    dependencies.generate_uuid,
  );

  try {
    const context =
      await authenticatedContext(
        dependencies,
      );

    if (context === null) {
      return errorResponse(
        trace,
        401,
        "UNAUTHORIZED",
        "Authentication is required.",
      );
    }

    const parsed =
      await parseJsonBody(request);

    if (!parsed.valid) {
      return errorResponse(
        trace,
        400,
        "INVALID_JSON",
        "The request body must be valid JSON.",
      );
    }

    const runtime =
      dependencies.get_runtime();

    const result = await createCapa(
      runtime.dependencies,
      {
        authentication:
          context.authentication,
        tenant: context.tenant,
        owner_user_id:
          context.owner_user_id,
        request_trace: trace,
        body: parsed.body,
      },
    );

    if (
      result.status ===
      "validation_failed"
    ) {
      return errorResponse(
        trace,
        400,
        "CAPA_VALIDATION_FAILED",
        "The CAPA request contains invalid fields.",
        result.issues,
      );
    }

    if (
      result.status ===
      "authorization_denied"
    ) {
      return errorResponse(
        trace,
        403,
        "CAPA_ACCESS_DENIED",
        "The CAPA operation is not authorized.",
      );
    }

    if (
      result.status ===
      "step_up_required"
    ) {
      return errorResponse(
        trace,
        403,
        "CAPA_STEP_UP_REQUIRED",
        "Additional authentication is required.",
      );
    }

    return jsonResponse(
      {
        capa: {
          capa_case_id:
            result.capa_case.capa_case_id,
          case_number:
            result.capa_case.case_number,
          status:
            result.capa_case.status,
          record_version:
            result.capa_case.record_version,
          current_version_id:
            result.capa_case
              .current_version_id,
          section_version_id:
            result.section_version
              .section_version_id,
          created_at:
            result.capa_case.created_at,
        },
        correlation_id:
          trace.correlation_id,
      },
      201,
    );
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

    return safeUnexpectedError(
      dependencies,
      trace,
      "creation",
      error,
    );
  }
}

export async function handleCapaGet(
  request: Request,
  dependencies:
    CapaApiHandlerDependencies,
): Promise<Response> {
  const trace = requestTrace(
    request,
    dependencies.generate_uuid,
  );

  try {
    const context =
      await authenticatedContext(
        dependencies,
      );

    if (context === null) {
      return errorResponse(
        trace,
        401,
        "UNAUTHORIZED",
        "Authentication is required.",
      );
    }

    const requestUrl =
      new URL(request.url);

    const caseId = normalizedUuid(
      requestUrl.searchParams.get("id"),
    );

    if (caseId === null) {
      return errorResponse(
        trace,
        400,
        "INVALID_CAPA_CASE_ID",
        "A valid CAPA case identifier is required.",
      );
    }

    const runtime =
      dependencies.get_runtime();

    const capaCase =
      await runtime.database.findCaseById(
        context.tenant.organization_id,
        caseId as CapaCaseId,
      );

    if (capaCase === null) {
      return errorResponse(
        trace,
        404,
        "CAPA_NOT_FOUND",
        "The CAPA case was not found.",
      );
    }

    const caseVersion =
      await runtime.database
        .findCaseVersionById(
          context.tenant.organization_id,
          capaCase.capa_case_id,
          capaCase.current_version_id,
        );

    if (caseVersion === null) {
      throw new Error(
        "Current CAPA version is missing.",
      );
    }

    const sectionVersions =
      await Promise.all(
        caseVersion.section_version_ids.map(
          (sectionVersionId) =>
            runtime.database
              .findSectionVersionById(
                context.tenant
                  .organization_id,
                capaCase.capa_case_id,
                sectionVersionId,
              ),
        ),
      );

    if (
      sectionVersions.some(
        (section) => section === null,
      )
    ) {
      throw new Error(
        "Referenced CAPA section is missing.",
      );
    }

    return jsonResponse(
      {
        capa: {
          ...capaCase,
          current_version:
            caseVersion,
          sections:
            sectionVersions,
        },
        correlation_id:
          trace.correlation_id,
      },
      200,
    );
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

    return safeUnexpectedError(
      dependencies,
      trace,
      "retrieval",
      error,
    );
  }
}