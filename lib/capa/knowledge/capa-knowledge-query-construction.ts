import { createHash } from "node:crypto";

import type {
  ControlledCode,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "../ai/capa-prompt-contract";

import type {
  CapaKnowledgeFingerprintRecord,
} from "./capa-knowledge-contract";

/**
 * Controlled, provider-neutral query construction for governed CAPA
 * retrieval.
 *
 * User text and authorized context remain search data. They cannot select a
 * collection, broaden authorization, alter retrieval policy, invoke a tool or
 * become system instructions.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * RET-001, RET-002, RET-010 through RET-012
 * KRC-T-007 and KRC-AC-006
 */

export const CAPA_KNOWLEDGE_QUERY_CONSTRUCTION_VERSION =
  "capa-knowledge-query-1.0.0" as
    ControlledVersion;

export const CAPA_KNOWLEDGE_QUERY_CONTEXT_FIELDS = [
  "case_type",
  "product",
  "site",
  "process",
  "event_type",
  "jurisdiction",
  "applicable_market",
] as const;

export type CapaKnowledgeQueryContextField =
  (typeof CAPA_KNOWLEDGE_QUERY_CONTEXT_FIELDS)[number];

export const CAPA_KNOWLEDGE_QUERY_CONSTRUCTION_REASON_CODES = [
  "INVALID_QUERY_INPUT",
  "INVALID_USER_QUERY",
  "QUERY_TOO_LARGE",
  "INVALID_TASK_TYPE",
  "INVALID_WORKFLOW_STATE",
  "INVALID_AUTHORIZED_CONTEXT",
  "AUTHORIZED_CONTEXT_TOO_LARGE",
] as const;

export type CapaKnowledgeQueryConstructionReasonCode =
  (typeof CAPA_KNOWLEDGE_QUERY_CONSTRUCTION_REASON_CODES)[number];

export class CapaKnowledgeQueryConstructionError
  extends Error {
  readonly reason_code:
    CapaKnowledgeQueryConstructionReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeQueryConstructionReasonCode,
  ) {
    super(
      "The governed CAPA knowledge query could not be constructed.",
    );
    this.name =
      "CapaKnowledgeQueryConstructionError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeAuthorizedQueryContext {
  readonly field:
    CapaKnowledgeQueryContextField;
  readonly value: string;
}

export interface CapaKnowledgeQueryConstructionInput {
  readonly user_query: string;
  readonly task_type:
    ControlledCode;
  readonly workflow_state:
    ControlledCode;
  readonly authorized_context:
    readonly CapaKnowledgeAuthorizedQueryContext[];
}

export interface CapaKnowledgeConstructedQuery {
  readonly query_construction_version:
    ControlledVersion;
  readonly task_type:
    ControlledCode;
  readonly workflow_state:
    ControlledCode;
  readonly normalized_user_query: string;
  readonly authorized_context:
    readonly CapaKnowledgeAuthorizedQueryContext[];
  readonly query_text: string;
  readonly query_fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly character_length: number;
  readonly utf8_byte_length: number;
}

export interface CapaKnowledgeQueryConstructionLimits {
  readonly maximum_user_query_characters?:
    number;
  readonly maximum_context_items?: number;
  readonly maximum_context_value_characters?:
    number;
  readonly maximum_query_characters?: number;
}

export const DEFAULT_MAXIMUM_USER_QUERY_CHARACTERS =
  4_000;
export const DEFAULT_MAXIMUM_QUERY_CONTEXT_ITEMS =
  32;
export const DEFAULT_MAXIMUM_QUERY_CONTEXT_VALUE_CHARACTERS =
  512;
export const DEFAULT_MAXIMUM_CONSTRUCTED_QUERY_CHARACTERS =
  8_000;

const CONTROLLED_CODE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const CONTEXT_FIELDS =
  new Set<string>(
    CAPA_KNOWLEDGE_QUERY_CONTEXT_FIELDS,
  );

function record(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function controlledLimit(
  value: number | undefined,
  fallback: number,
): number {
  const resolved = value ?? fallback;

  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1
  ) {
    throw new CapaKnowledgeQueryConstructionError(
      "INVALID_QUERY_INPUT",
    );
  }

  return resolved;
}

function normalizeSearchText(
  value: string,
): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .replace(/[\t\n\f\r ]+/g, " ")
    .trim();
}

function validControlledCode(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    CONTROLLED_CODE_PATTERN.test(value);
}

function fingerprint(
  canonicalPayload: string,
): CapaKnowledgeFingerprintRecord {
  return Object.freeze({
    algorithm: "sha256" as const,
    value:
      createHash("sha256")
        .update(canonicalPayload, "utf8")
        .digest("hex") as
          CapaKnowledgeFingerprintRecord["value"],
  });
}

function fail(
  reasonCode:
    CapaKnowledgeQueryConstructionReasonCode,
): never {
  throw new CapaKnowledgeQueryConstructionError(
    reasonCode,
  );
}

/**
 * Produces a deterministic query. No model rewrite, expansion, synonym
 * generation, collection selection or authorization decision occurs here.
 */
export function constructCapaKnowledgeQuery(
  input: unknown,
  limits: CapaKnowledgeQueryConstructionLimits = {},
): CapaKnowledgeConstructedQuery {
  const candidate = record(input);

  if (candidate === null) {
    fail("INVALID_QUERY_INPUT");
  }

  if (typeof candidate.user_query !== "string") {
    fail("INVALID_USER_QUERY");
  }

  const maximumUserQueryCharacters =
    controlledLimit(
      limits.maximum_user_query_characters,
      DEFAULT_MAXIMUM_USER_QUERY_CHARACTERS,
    );
  const maximumContextItems =
    controlledLimit(
      limits.maximum_context_items,
      DEFAULT_MAXIMUM_QUERY_CONTEXT_ITEMS,
    );
  const maximumContextValueCharacters =
    controlledLimit(
      limits.maximum_context_value_characters,
      DEFAULT_MAXIMUM_QUERY_CONTEXT_VALUE_CHARACTERS,
    );
  const maximumQueryCharacters =
    controlledLimit(
      limits.maximum_query_characters,
      DEFAULT_MAXIMUM_CONSTRUCTED_QUERY_CHARACTERS,
    );

  const normalizedUserQuery =
    normalizeSearchText(candidate.user_query);

  if (normalizedUserQuery.length === 0) {
    fail("INVALID_USER_QUERY");
  }

  if (
    normalizedUserQuery.length >
      maximumUserQueryCharacters
  ) {
    fail("QUERY_TOO_LARGE");
  }

  if (!validControlledCode(candidate.task_type)) {
    fail("INVALID_TASK_TYPE");
  }

  if (
    !validControlledCode(
      candidate.workflow_state,
    )
  ) {
    fail("INVALID_WORKFLOW_STATE");
  }

  if (!Array.isArray(candidate.authorized_context)) {
    fail("INVALID_AUTHORIZED_CONTEXT");
  }

  if (
    candidate.authorized_context.length >
      maximumContextItems
  ) {
    fail("AUTHORIZED_CONTEXT_TOO_LARGE");
  }

  const normalizedContext:
    CapaKnowledgeAuthorizedQueryContext[] = [];

  for (
    const untrustedItem
    of candidate.authorized_context
  ) {
    const item = record(untrustedItem);

    if (
      item === null ||
      typeof item.field !== "string" ||
      !CONTEXT_FIELDS.has(item.field) ||
      typeof item.value !== "string"
    ) {
      fail("INVALID_AUTHORIZED_CONTEXT");
    }

    const normalizedValue =
      normalizeSearchText(item.value);

    if (normalizedValue.length === 0) {
      fail("INVALID_AUTHORIZED_CONTEXT");
    }

    if (
      normalizedValue.length >
        maximumContextValueCharacters
    ) {
      fail("AUTHORIZED_CONTEXT_TOO_LARGE");
    }

    normalizedContext.push({
      field:
        item.field as
          CapaKnowledgeQueryContextField,
      value: normalizedValue,
    });
  }

  const uniqueContext = Array.from(
    new Map(
      normalizedContext.map(
        (item) => [
          `${item.field}\u0000${item.value}`,
          item,
        ],
      ),
    ).values(),
  ).sort(
    (left, right) =>
      left.field.localeCompare(right.field) ||
      left.value.localeCompare(right.value),
  ).map(
    (item) => Object.freeze({ ...item }),
  );

  const queryText = [
    normalizedUserQuery,
    ...uniqueContext.map(
      (item) =>
        `${item.field}: ${item.value}`,
    ),
  ].join("\n");

  if (queryText.length > maximumQueryCharacters) {
    fail("QUERY_TOO_LARGE");
  }

  const canonicalPayload = JSON.stringify({
    query_construction_version:
      CAPA_KNOWLEDGE_QUERY_CONSTRUCTION_VERSION,
    task_type: candidate.task_type,
    workflow_state: candidate.workflow_state,
    normalized_user_query:
      normalizedUserQuery,
    authorized_context: uniqueContext,
  });

  return Object.freeze({
    query_construction_version:
      CAPA_KNOWLEDGE_QUERY_CONSTRUCTION_VERSION,
    task_type:
      candidate.task_type as ControlledCode,
    workflow_state:
      candidate.workflow_state as ControlledCode,
    normalized_user_query:
      normalizedUserQuery,
    authorized_context:
      Object.freeze(uniqueContext),
    query_text: queryText,
    query_fingerprint:
      fingerprint(canonicalPayload),
    character_length: queryText.length,
    utf8_byte_length:
      Buffer.byteLength(queryText, "utf8"),
  });
}
