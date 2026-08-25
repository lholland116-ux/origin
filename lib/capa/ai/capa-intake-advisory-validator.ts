import {
  CAPA_INTAKE_ADVISORY_OUTPUT,
  type CapaIntakeAdvisoryRequest,
} from "./capa-intake-advisory-contract";

/** Browser input validation for governed CAPA intake assistance. */

const MAXIMUM_FOCUS_CHARACTERS = 1_000;

const ALLOWED_BROWSER_FIELDS =
  new Set(["focus"]);

export const CAPA_INTAKE_ADVISORY_VALIDATION_REASON_CODES = [
  "INVALID_ADVISORY_INPUT",
  "UNSUPPORTED_ADVISORY_INPUT_FIELD",
  "ADVISORY_FOCUS_TOO_LONG",
] as const;

export type CapaIntakeAdvisoryValidationReasonCode =
  (typeof CAPA_INTAKE_ADVISORY_VALIDATION_REASON_CODES)[number];

export class CapaIntakeAdvisoryValidationError
  extends Error {
  readonly reason_code:
    CapaIntakeAdvisoryValidationReasonCode;

  constructor(
    reasonCode:
      CapaIntakeAdvisoryValidationReasonCode,
  ) {
    super(
      "The governed CAPA intake advisory request is invalid.",
    );
    this.name =
      "CapaIntakeAdvisoryValidationError";
    this.reason_code = reasonCode;
  }
}

function fail(
  reasonCode:
    CapaIntakeAdvisoryValidationReasonCode,
): never {
  throw new CapaIntakeAdvisoryValidationError(
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

function controlledFocus(
  value: unknown,
): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    fail("INVALID_ADVISORY_INPUT");
  }

  const normalized = value
    .normalize("NFKC")
    .trim();

  if (normalized.length === 0) {
    return null;
  }

  if (
    normalized.length >
      MAXIMUM_FOCUS_CHARACTERS
  ) {
    fail("ADVISORY_FOCUS_TOO_LONG");
  }

  return normalized;
}

/**
 * Converts an untrusted JSON body into the only browser-controlled part of
 * an advisory request. All authority-bearing facts are intentionally absent.
 */
export function validateCapaIntakeAdvisoryBrowserRequest(
  value: unknown,
): CapaIntakeAdvisoryRequest {
  if (!isRecord(value)) {
    fail("INVALID_ADVISORY_INPUT");
  }

  for (const field of Object.keys(value)) {
    if (!ALLOWED_BROWSER_FIELDS.has(field)) {
      fail(
        "UNSUPPORTED_ADVISORY_INPUT_FIELD",
      );
    }
  }

  return Object.freeze({
    requested_output:
      CAPA_INTAKE_ADVISORY_OUTPUT,
    focus: controlledFocus(value.focus),
  });
}
