import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_BLOCKER_WARNING_KINDS,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_CHANGE_TYPES,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_EVIDENCE_RELATIONSHIPS,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SOURCE_STATUSES,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_UNCERTAINTY_CATEGORIES,
  type CapaRootCauseReviewAdvisoryAuthoritativeIdentifier,
  type CapaRootCauseReviewAdvisoryBlockerWarning,
  type CapaRootCauseReviewAdvisoryEvidenceMapEntry,
  type CapaRootCauseReviewAdvisoryProposal,
  type CapaRootCauseReviewAdvisoryReferenceKey,
  type CapaRootCauseReviewAdvisoryUncertainty,
  type CapaRootCauseReviewAdvisoryVersionChange,
  type RawCapaRootCauseReviewAdvisoryModelOutput,
} from "./capa-root-cause-review-advisory-contract";

/** Strict fail-closed validation for the governed S50 review-packet output. */

const MAXIMUM_RAW_OUTPUT_CHARACTERS = 40_000;
const MAXIMUM_ITEMS = 20;
const MAXIMUM_SUMMARY_CHARACTERS = 4_000;
const MAXIMUM_TEXT_CHARACTERS = 2_000;
const MAXIMUM_QUESTION_CHARACTERS = 1_000;

const TOP_LEVEL_FIELDS = [
  "schema_version",
  "status",
  "proposal",
  "uncertainty_and_limitations",
  "citations",
  "advisory_only",
  "workflow_mutated",
  "controlled_record_mutated",
  "review_disposition",
  "workflow_transition",
  "human_acceptance_required",
] as const;

const PROPOSAL_FIELDS = [
  "neutral_review_summary",
  "version_changes",
  "blockers_warnings",
  "evidence_map",
] as const;

const VERSION_CHANGE_FIELDS = [
  "change_key",
  "subject",
  "change_type",
  "previous_value",
  "current_value",
  "authoritative_identifier",
  "reference_keys",
  "human_review_question",
] as const;

const BLOCKER_WARNING_FIELDS = [
  "warning_key",
  "kind",
  "subject",
  "description",
  "authoritative_identifier",
  "reference_keys",
  "human_review_question",
] as const;

const EVIDENCE_MAP_FIELDS = [
  "mapping_key",
  "subject",
  "relationship",
  "description",
  "evidence_reference_keys",
  "source_status",
  "authoritative_identifier",
  "human_review_question",
] as const;

const UNCERTAINTY_FIELDS = [
  "category",
  "human_review_question",
] as const;

const EMPTY_MODEL_CITATIONS = Object.freeze([] as const);

const CHANGE_KEY_PATTERN = /^V[1-9][0-9]{0,2}$/;
const WARNING_KEY_PATTERN = /^B[1-9][0-9]{0,2}$/;
const MAPPING_KEY_PATTERN = /^E[1-9][0-9]{0,2}$/;
const REFERENCE_KEY_PATTERN = /^R[1-9][0-9]{0,2}$/;
const AUTHORITATIVE_IDENTIFIER_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

/**
 * These patterns protect the S50 boundary itself. Source-reporting language
 * is allowed only in fields explicitly used to describe submitted material;
 * workflow actions, AI authority claims and record mutation claims remain
 * prohibited in every field.
 */
const HARD_PROHIBITED_S50_PATTERNS = [
  /\b(?:advance|advanced|transition|transitioned|release|released|submit|submitted|move|moved)\b[\s\S]{0,100}\b(?:workflow|case|capa|s50|s60)\b/i,
  /\b(?:workflow|case|capa|s50|s60)\b[\s\S]{0,100}\b(?:advance|advanced|transition|transitioned|release|released|submit|submitted|move|moved)\b/i,
  /\b(?:the\s+)?ai\b\s+(?:has\s+|will\s+|can\s+|may\s+|does\s+)?(?:approve(?:s|d)?|accept(?:s|ed)?|confirm(?:s|ed)?|reject(?:s|ed)?|verif(?:y|ies|ied)|determin(?:e|es|ed)|authoriz(?:e|es|ed))\b/i,
  /\b(?:the\s+)?ai\b[\s\S]{0,50}\b(?:decision|determination|conclusion)\b[\s\S]{0,20}\b(?:is|was|remains)\s+(?:authoritative|final|binding)\b/i,
  /\b(?:i|we|the\s+ai|the\s+model|the\s+assistant)\b\s+(?:am|are|act\s+as|serve\s+as)\s+(?:the\s+)?(?:reviewer|approver|authorized\s+decision[- ]maker)\b/i,
  /\b(?:sign|signed)\b[\s\S]{0,80}\b(?:controlled\s+record|record|capa|case)\b/i,
  /\b(?:mutate|mutated|modify|modified|update|updated|change|changed)\b[\s\S]{0,80}\b(?:controlled\s+record|record|capa|case)\b/i,
  /\b(?:set|sets|setting|assign|assigned)\b[\s\S]{0,80}\b(?:review\s+disposition|disposition|workflow\s+state)\b/i,
];

const DECISION_PROHIBITED_S50_PATTERNS = [
  /\b(?:approve|approved|accept|accepted|reject|rejected|confirm|confirmed|verify|verified|resolve|resolved|determine|determined|establish|established)\b[\s\S]{0,80}\b(?:root[- ]cause|hypothesis|g-?04|review\s+disposition)\b/i,
  /\b(?:root[- ]cause|hypothesis|g-?04|review\s+disposition|capa|case|controlled\s+record)\b[\s\S]{0,80}\b(?:approve|approved|accept|accepted|reject|rejected|confirm|confirmed|verify|verified|resolve|resolved|determine|determined|establish|established|closed|signed)\b/i,
  /\b(?:approve|approved|accept|accepted|reject|rejected|confirm|confirmed|verify|verified|resolve|resolved|determine|determined|establish|established|close|closed|sign|signed)\b[\s\S]{0,80}\b(?:root[- ]cause|hypothesis|g-?04|review\s+disposition|capa|case|controlled\s+record)\b/i,
];

const SOURCE_REPORTING_CLAUSE_PATTERN =
  /^(?:the\s+)?(?:submitted|authoritative|controlled)\s+(?:package|record|source|entry)\s+(?:identifies|reports|records|states|lists|describes)\b[^.!?;,\n\r]*$/i;
const SOURCE_REPORTING_STATUS_PATTERN =
  /\b(?:confirmed|approved|rejected|accepted|verified|resolved)\b/gi;
const SOURCE_REPORTING_SUBJECT_PATTERN =
  /\b(?:hypothesis|root[- ]cause|g-?04|review\s+disposition)\b/gi;

const CLAUSE_SEPARATOR = /[.!?;\n\r]+/;

const QUESTION_ASSERTION_SEPARATOR =
  /[.!?;,\:\n\r\u2028\u2029]|\s-\s|\s+[—–]\s+|\b(?:but|however|although|though|yet|while|because|since|therefore|thus)\b/i;

const QUESTION_START =
  /^(?:does|do|did|is|are|was|were|may|might|can|could|should|would|must|what|which|who|whom|whose|why|how|when|where|whether)\b/i;

const QUESTION_COMPOUND_AND_CLAUSE =
  /\band\s+(?:does|do|did|is|are|was|were|may|might|can|could|should|would|must|what|which|who|whom|whose|why|how|when|where|whether)\b/i;

function isNeutralSourceReportingClause(
  clause: string,
): boolean {
  return SOURCE_REPORTING_CLAUSE_PATTERN.test(clause) &&
    [...clause.matchAll(SOURCE_REPORTING_STATUS_PATTERN)].length === 1 &&
    [...clause.matchAll(SOURCE_REPORTING_SUBJECT_PATTERN)].length <= 1;
}

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_VALIDATION_REASON_CODES = [
  "EMPTY_MODEL_OUTPUT",
  "MODEL_OUTPUT_TOO_LARGE",
  "MODEL_OUTPUT_NOT_JSON",
  "MODEL_OUTPUT_NOT_OBJECT",
  "UNSUPPORTED_MODEL_OUTPUT_FIELD",
  "MISSING_MODEL_OUTPUT_FIELD",
  "INVALID_SCHEMA_VERSION",
  "INVALID_STATUS",
  "INVALID_REVIEW_PACKET",
  "INVALID_NEUTRAL_REVIEW_SUMMARY",
  "INVALID_VERSION_CHANGES",
  "INVALID_VERSION_CHANGE",
  "INVALID_BLOCKERS_WARNINGS",
  "INVALID_BLOCKER_WARNING",
  "INVALID_EVIDENCE_MAP",
  "INVALID_EVIDENCE_MAP_ENTRY",
  "INVALID_OUTPUT_TEXT",
  "INVALID_OUTPUT_LIST",
  "INVALID_ADVISORY_QUESTION",
  "INVALID_IDENTIFIER",
  "DUPLICATE_CONTROLLED_IDENTIFIER",
  "INVALID_REFERENCE_KEY",
  "DUPLICATE_REFERENCE_KEY",
  "INVALID_ENUM_VALUE",
  "INVALID_UNCERTAINTY_OR_LIMITATION",
  "INVALID_CITATIONS",
  "INVALID_ADVISORY_FLAGS",
  "PROHIBITED_S50_DECISION_CLAIM",
] as const;

export type CapaRootCauseReviewAdvisoryOutputValidationReasonCode =
  (typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_VALIDATION_REASON_CODES)[number];

export class CapaRootCauseReviewAdvisoryOutputValidationError
  extends Error {
  readonly reason_code:
    CapaRootCauseReviewAdvisoryOutputValidationReasonCode;

  constructor(
    reasonCode:
      CapaRootCauseReviewAdvisoryOutputValidationReasonCode,
  ) {
    super(
      "The governed CAPA S50 root-cause review advisory model output failed controlled validation.",
    );
    this.name =
      "CapaRootCauseReviewAdvisoryOutputValidationError";
    this.reason_code = reasonCode;
  }
}

function fail(
  reasonCode:
    CapaRootCauseReviewAdvisoryOutputValidationReasonCode,
): never {
  throw new CapaRootCauseReviewAdvisoryOutputValidationError(
    reasonCode,
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function exactFields(
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
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail("MISSING_MODEL_OUTPUT_FIELD");
    }
  }
}

function hasProhibitedAuthorityClaim(
  normalized: string,
  allowSourceReporting: boolean,
): boolean {
  if (HARD_PROHIBITED_S50_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  )) {
    return true;
  }

  const clauses = normalized
    .split(CLAUSE_SEPARATOR)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

  return clauses.some((clause) =>
    DECISION_PROHIBITED_S50_PATTERNS.some((pattern) =>
      pattern.test(clause) &&
      !(allowSourceReporting &&
        isNeutralSourceReportingClause(clause)),
    ),
  );
}

function text(
  value: unknown,
  maximumCharacters = MAXIMUM_TEXT_CHARACTERS,
  allowSourceReporting = false,
): string {
  if (typeof value !== "string") {
    fail("INVALID_OUTPUT_TEXT");
  }

  const normalized = value.normalize("NFKC").trim();

  if (
    normalized.length === 0 ||
    normalized.length > maximumCharacters
  ) {
    fail("INVALID_OUTPUT_TEXT");
  }

  if (
    hasProhibitedAuthorityClaim(
      normalized,
      allowSourceReporting,
    )
  ) {
    fail("PROHIBITED_S50_DECISION_CLAIM");
  }

  return normalized;
}

function optionalText(
  value: unknown,
  allowSourceReporting = false,
): string | null {
  if (value === null) return null;
  return text(value, MAXIMUM_TEXT_CHARACTERS, allowSourceReporting);
}

function question(value: unknown): string {
  const normalized = text(value, MAXIMUM_QUESTION_CHARACTERS);
  const body = normalized.slice(0, -1).trim();

  if (
    !normalized.endsWith("?") ||
    normalized.indexOf("?") !== normalized.length - 1 ||
    QUESTION_ASSERTION_SEPARATOR.test(body) ||
    QUESTION_COMPOUND_AND_CLAUSE.test(body) ||
    !QUESTION_START.test(body)
  ) {
    fail("INVALID_ADVISORY_QUESTION");
  }

  return normalized;
}

function boundedList(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_ITEMS) {
    fail("INVALID_OUTPUT_LIST");
  }

  return value;
}

function localIdentifier(
  value: unknown,
  pattern: RegExp,
  used: Set<string>,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("INVALID_IDENTIFIER");
  }

  if (used.has(value)) {
    fail("DUPLICATE_CONTROLLED_IDENTIFIER");
  }

  used.add(value);
  return value;
}

function authoritativeIdentifier(
  value: unknown,
): CapaRootCauseReviewAdvisoryAuthoritativeIdentifier | null {
  if (value === null) return null;

  if (
    typeof value !== "string" ||
    !AUTHORITATIVE_IDENTIFIER_PATTERN.test(value)
  ) {
    fail("INVALID_IDENTIFIER");
  }

  return value as CapaRootCauseReviewAdvisoryAuthoritativeIdentifier;
}

function referenceKeys(
  value: unknown,
): readonly CapaRootCauseReviewAdvisoryReferenceKey[] {
  const raw = boundedList(value);
  const used = new Set<string>();

  return Object.freeze(
    raw.map((entry) => {
      if (
        typeof entry !== "string" ||
        !REFERENCE_KEY_PATTERN.test(entry)
      ) {
        fail("INVALID_REFERENCE_KEY");
      }

      if (used.has(entry)) {
        fail("DUPLICATE_REFERENCE_KEY");
      }

      used.add(entry);
      return entry as CapaRootCauseReviewAdvisoryReferenceKey;
    }),
  );
}

function versionChanges(
  value: unknown,
): readonly CapaRootCauseReviewAdvisoryVersionChange[] {
  const used = new Set<string>();

  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_VERSION_CHANGE");
      }

      exactFields(source, VERSION_CHANGE_FIELDS);

      const changeType = source.change_type;
      if (!CAPA_ROOT_CAUSE_REVIEW_ADVISORY_CHANGE_TYPES.includes(
        changeType as never,
      )) {
        fail("INVALID_ENUM_VALUE");
      }

      return Object.freeze({
        change_key: localIdentifier(
          source.change_key,
          CHANGE_KEY_PATTERN,
          used,
        ),
        subject: text(source.subject),
        change_type: changeType as CapaRootCauseReviewAdvisoryVersionChange["change_type"],
        previous_value: optionalText(source.previous_value, true),
        current_value: optionalText(source.current_value, true),
        authoritative_identifier:
          authoritativeIdentifier(source.authoritative_identifier),
        reference_keys: referenceKeys(source.reference_keys),
        human_review_question: question(
          source.human_review_question,
        ),
      });
    }),
  );
}

function blockersWarnings(
  value: unknown,
): readonly CapaRootCauseReviewAdvisoryBlockerWarning[] {
  const used = new Set<string>();

  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_BLOCKER_WARNING");
      }

      exactFields(source, BLOCKER_WARNING_FIELDS);

      const kind = source.kind;
      if (!CAPA_ROOT_CAUSE_REVIEW_ADVISORY_BLOCKER_WARNING_KINDS.includes(
        kind as never,
      )) {
        fail("INVALID_ENUM_VALUE");
      }

      const referenceKeysValue = referenceKeys(
        source.reference_keys,
      );
      const authoritativeIdentifierValue =
        authoritativeIdentifier(
          source.authoritative_identifier,
        );

      if (
        kind === "authoritative_source_reported_blocker" &&
        referenceKeysValue.length === 0 &&
        authoritativeIdentifierValue === null
      ) {
        fail("INVALID_BLOCKER_WARNING");
      }

      return Object.freeze({
        warning_key: localIdentifier(
          source.warning_key,
          WARNING_KEY_PATTERN,
          used,
        ),
        kind: kind as CapaRootCauseReviewAdvisoryBlockerWarning["kind"],
        subject: text(source.subject),
        description: text(
          source.description,
          MAXIMUM_TEXT_CHARACTERS,
          kind === "authoritative_source_reported_blocker",
        ),
        authoritative_identifier:
          authoritativeIdentifierValue,
        reference_keys: referenceKeysValue,
        human_review_question: question(
          source.human_review_question,
        ),
      });
    }),
  );
}

function evidenceMap(
  value: unknown,
): readonly CapaRootCauseReviewAdvisoryEvidenceMapEntry[] {
  const used = new Set<string>();

  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_EVIDENCE_MAP_ENTRY");
      }

      exactFields(source, EVIDENCE_MAP_FIELDS);

      const relationship = source.relationship;
      if (!CAPA_ROOT_CAUSE_REVIEW_ADVISORY_EVIDENCE_RELATIONSHIPS.includes(
        relationship as never,
      )) {
        fail("INVALID_ENUM_VALUE");
      }

      const evidenceReferenceKeys = referenceKeys(
        source.evidence_reference_keys,
      );
      const sourceStatus = source.source_status;
      if (!CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SOURCE_STATUSES.includes(
        sourceStatus as never,
      )) {
        fail("INVALID_ENUM_VALUE");
      }

      const authoritativeIdentifierValue =
        authoritativeIdentifier(
          source.authoritative_identifier,
        );

      if (
        relationship !== "missing_support" &&
        evidenceReferenceKeys.length === 0
      ) {
        fail("INVALID_EVIDENCE_MAP_ENTRY");
      }

      if (
        sourceStatus === "source_reported" &&
        evidenceReferenceKeys.length === 0 &&
        authoritativeIdentifierValue === null
      ) {
        fail("INVALID_EVIDENCE_MAP_ENTRY");
      }

      return Object.freeze({
        mapping_key: localIdentifier(
          source.mapping_key,
          MAPPING_KEY_PATTERN,
          used,
        ),
        subject: text(source.subject),
        relationship: relationship as CapaRootCauseReviewAdvisoryEvidenceMapEntry["relationship"],
        description: text(
          source.description,
          MAXIMUM_TEXT_CHARACTERS,
          sourceStatus === "source_reported",
        ),
        evidence_reference_keys: evidenceReferenceKeys,
        source_status: sourceStatus as CapaRootCauseReviewAdvisoryEvidenceMapEntry["source_status"],
        authoritative_identifier:
          authoritativeIdentifierValue,
        human_review_question: question(
          source.human_review_question,
        ),
      });
    }),
  );
}

function proposal(
  value: unknown,
): CapaRootCauseReviewAdvisoryProposal {
  if (!isRecord(value)) {
    fail("INVALID_REVIEW_PACKET");
  }

  exactFields(value, PROPOSAL_FIELDS);

  return Object.freeze({
    neutral_review_summary: text(
      value.neutral_review_summary,
      MAXIMUM_SUMMARY_CHARACTERS,
      true,
    ),
    version_changes: versionChanges(
      value.version_changes,
    ),
    blockers_warnings: blockersWarnings(
      value.blockers_warnings,
    ),
    evidence_map: evidenceMap(value.evidence_map),
  });
}

function uncertainties(
  value: unknown,
): readonly CapaRootCauseReviewAdvisoryUncertainty[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_UNCERTAINTY_OR_LIMITATION");
      }

      exactFields(source, UNCERTAINTY_FIELDS);

      if (!CAPA_ROOT_CAUSE_REVIEW_ADVISORY_UNCERTAINTY_CATEGORIES.includes(
        source.category as never,
      )) {
        fail("INVALID_ENUM_VALUE");
      }

      return Object.freeze({
        category:
          source.category as CapaRootCauseReviewAdvisoryUncertainty["category"],
        human_review_question: question(
          source.human_review_question,
        ),
      });
    }),
  );
}

export function validateCapaRootCauseReviewAdvisoryModelOutput(
  rawOutput: string,
): RawCapaRootCauseReviewAdvisoryModelOutput {
  if (
    typeof rawOutput !== "string" ||
    rawOutput.trim().length === 0
  ) {
    fail("EMPTY_MODEL_OUTPUT");
  }

  const normalized = rawOutput.trim();

  if (normalized.length > MAXIMUM_RAW_OUTPUT_CHARACTERS) {
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

  exactFields(parsed, TOP_LEVEL_FIELDS);

  if (
    parsed.schema_version !==
      CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION
  ) {
    fail("INVALID_SCHEMA_VERSION");
  }

  if (parsed.status !== "completed_draft") {
    fail("INVALID_STATUS");
  }

  if (
    parsed.advisory_only !== true ||
    parsed.workflow_mutated !== false ||
    parsed.controlled_record_mutated !== false ||
    parsed.review_disposition !== null ||
    parsed.workflow_transition !== null ||
    parsed.human_acceptance_required !== true
  ) {
    fail("INVALID_ADVISORY_FLAGS");
  }

  if (
    !Array.isArray(parsed.citations) ||
    parsed.citations.length !== 0
  ) {
    fail("INVALID_CITATIONS");
  }

  return Object.freeze({
    schema_version:
      CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
    status: "completed_draft",
    proposal: proposal(parsed.proposal),
    uncertainty_and_limitations: uncertainties(
      parsed.uncertainty_and_limitations,
    ),
    citations: EMPTY_MODEL_CITATIONS,
    advisory_only: true,
    workflow_mutated: false,
    controlled_record_mutated: false,
    review_disposition: null,
    workflow_transition: null,
    human_acceptance_required: true,
  });
}
