import type {
  CapaIntakeAdvisoryProposal,
} from "./capa-intake-advisory-contract";

/** Strict validation for untrusted structured model output. */

const MAXIMUM_RAW_OUTPUT_CHARACTERS =
  30_000;
const MAXIMUM_PROBLEM_STATEMENT_CHARACTERS =
  4_000;
const MAXIMUM_LIST_ITEMS = 20;
const MAXIMUM_LIST_ITEM_CHARACTERS =
  1_000;

const TOP_LEVEL_FIELDS = Object.freeze([
  "proposal",
  "assumptions",
  "missing_information",
  "conflicts_and_alternatives",
  "uncertainty_and_limitations",
  "human_action_required",
  "warnings",
] as const);

const PROPOSAL_FIELDS = Object.freeze([
  "problem_statement_draft",
  "scope_dimensions",
  "missing_dimensions",
  "containment_risk_questions",
  "investigation_questions",
] as const);

const PROHIBITED_AUTHORITY_PATTERN =
  /\b(?:capa|record|case)\s+(?:is|has been)\s+(?:approved|closed|cancelled|canceled|reopened)\b|\bworkflow\s+(?:was|has been)\s+transitioned\b/i;

export const CAPA_INTAKE_ADVISORY_OUTPUT_VALIDATION_REASON_CODES = [
  "EMPTY_MODEL_OUTPUT",
  "MODEL_OUTPUT_TOO_LARGE",
  "MODEL_OUTPUT_NOT_JSON",
  "MODEL_OUTPUT_NOT_OBJECT",
  "UNSUPPORTED_MODEL_OUTPUT_FIELD",
  "MISSING_MODEL_OUTPUT_FIELD",
  "INVALID_PROPOSAL",
  "INVALID_OUTPUT_TEXT",
  "INVALID_OUTPUT_LIST",
  "PROHIBITED_AUTHORITY_CLAIM",
] as const;

export type CapaIntakeAdvisoryOutputValidationReasonCode =
  (typeof CAPA_INTAKE_ADVISORY_OUTPUT_VALIDATION_REASON_CODES)[number];

export class CapaIntakeAdvisoryOutputValidationError
  extends Error {
  readonly reason_code:
    CapaIntakeAdvisoryOutputValidationReasonCode;

  constructor(
    reasonCode:
      CapaIntakeAdvisoryOutputValidationReasonCode,
  ) {
    super(
      "The CAPA advisory model output failed controlled validation.",
    );
    this.name =
      "CapaIntakeAdvisoryOutputValidationError";
    this.reason_code = reasonCode;
  }
}

export interface ValidatedCapaIntakeAdvisoryOutput {
  readonly proposal:
    CapaIntakeAdvisoryProposal;
  readonly assumptions:
    readonly string[];
  readonly missing_information:
    readonly string[];
  readonly conflicts_and_alternatives:
    readonly string[];
  readonly uncertainty_and_limitations:
    readonly string[];
  readonly human_action_required:
    readonly string[];
  readonly warnings: readonly string[];
}

function fail(
  reasonCode:
    CapaIntakeAdvisoryOutputValidationReasonCode,
): never {
  throw new CapaIntakeAdvisoryOutputValidationError(
    reasonCode,
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requireExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const expected = new Set(fields);

  for (const field of Object.keys(value)) {
    if (!expected.has(field)) {
      fail("UNSUPPORTED_MODEL_OUTPUT_FIELD");
    }
  }

  for (const field of fields) {
    if (
      !Object.prototype.hasOwnProperty.call(
        value,
        field,
      )
    ) {
      fail("MISSING_MODEL_OUTPUT_FIELD");
    }
  }
}

function controlledText(
  value: unknown,
  maximumCharacters: number,
): string {
  if (typeof value !== "string") {
    fail("INVALID_OUTPUT_TEXT");
  }

  const normalized = value
    .normalize("NFKC")
    .trim();

  if (
    normalized.length === 0 ||
    normalized.length > maximumCharacters
  ) {
    fail("INVALID_OUTPUT_TEXT");
  }

  if (
    PROHIBITED_AUTHORITY_PATTERN.test(
      normalized,
    )
  ) {
    fail("PROHIBITED_AUTHORITY_CLAIM");
  }

  return normalized;
}

function controlledList(
  value: unknown,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAXIMUM_LIST_ITEMS
  ) {
    fail("INVALID_OUTPUT_LIST");
  }

  return Object.freeze(
    value.map((item) =>
      controlledText(
        item,
        MAXIMUM_LIST_ITEM_CHARACTERS,
      ),
    ),
  );
}

function controlledProposal(
  value: unknown,
): CapaIntakeAdvisoryProposal {
  if (!isRecord(value)) {
    fail("INVALID_PROPOSAL");
  }

  requireExactFields(
    value,
    PROPOSAL_FIELDS,
  );

  return Object.freeze({
    problem_statement_draft:
      controlledText(
        value.problem_statement_draft,
        MAXIMUM_PROBLEM_STATEMENT_CHARACTERS,
      ),
    scope_dimensions:
      controlledList(
        value.scope_dimensions,
      ),
    missing_dimensions:
      controlledList(
        value.missing_dimensions,
      ),
    containment_risk_questions:
      controlledList(
        value.containment_risk_questions,
      ),
    investigation_questions:
      controlledList(
        value.investigation_questions,
      ),
  });
}

export function validateCapaIntakeAdvisoryModelOutput(
  rawOutput: string,
): ValidatedCapaIntakeAdvisoryOutput {
  if (typeof rawOutput !== "string") {
    fail("EMPTY_MODEL_OUTPUT");
  }

  const normalized = rawOutput.trim();

  if (normalized.length === 0) {
    fail("EMPTY_MODEL_OUTPUT");
  }

  if (
    normalized.length >
      MAXIMUM_RAW_OUTPUT_CHARACTERS
  ) {
    fail("MODEL_OUTPUT_TOO_LARGE");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    fail("MODEL_OUTPUT_NOT_JSON");
  }

  if (!isRecord(parsed)) {
    fail("MODEL_OUTPUT_NOT_OBJECT");
  }

  requireExactFields(
    parsed,
    TOP_LEVEL_FIELDS,
  );

  return Object.freeze({
    proposal:
      controlledProposal(parsed.proposal),
    assumptions:
      controlledList(parsed.assumptions),
    missing_information:
      controlledList(
        parsed.missing_information,
      ),
    conflicts_and_alternatives:
      controlledList(
        parsed.conflicts_and_alternatives,
      ),
    uncertainty_and_limitations:
      controlledList(
        parsed.uncertainty_and_limitations,
      ),
    human_action_required:
      controlledList(
        parsed.human_action_required,
      ),
    warnings:
      controlledList(parsed.warnings),
  });
}
