import type {
  CapaScopeApplicabilityDecision,
  CapaScopeContent,
  CapaScopeElement,
  CapaScopeElementType,
  CapaScopeEscalation,
  CapaScopeEscalationStatus,
  CapaScopeExclusion,
  CapaScopeTargetDate,
} from "@/lib/capa/domain/capa-scope";

const ELEMENT_TYPES:
  readonly CapaScopeElementType[] = [
    "product",
    "process",
    "site",
    "supplier",
    "system",
    "other",
  ];

const ESCALATION_STATUSES:
  readonly CapaScopeEscalationStatus[] = [
    "open",
    "resolved",
  ];

export interface CapaScopeReviewDraft {
  readonly problemStatement:
    string;

  readonly what:
    string;

  readonly where:
    string;

  readonly when:
    string;

  readonly extentDimension:
    string;

  readonly detectionMethod:
    string;

  /**
   * One row per line:
   * product | Product A
   * process | Packaging
   */
  readonly affectedScopeRows:
    string;

  /**
   * One included scope item per line.
   */
  readonly includedScope:
    string;

  /**
   * Optional. One row per line:
   * subject | rationale
   */
  readonly exclusionRows:
    string;

  readonly magnitude:
    string;

  readonly frequency:
    string;

  readonly trend:
    string;

  readonly affectedPopulation:
    string;

  readonly priority:
    string;

  /**
   * One row per line:
   * Completion target | 2026-09-30
   */
  readonly targetDateRows:
    string;

  readonly applicabilityDecision:
    "" | CapaScopeApplicabilityDecision;

  readonly applicabilityRationale:
    string;

  readonly sourceReference:
    string;

  /**
   * One evidence reference per line.
   */
  readonly evidenceReferences:
    string;

  /**
   * One unresolved gap per line.
   *
   * G-01 cannot be accepted while this contains an unresolved item.
   */
  readonly unresolvedScopeGaps:
    string;

  /**
   * Optional. One row per line:
   * process | reference | resolved | rationale
   */
  readonly escalationRows:
    string;

  readonly approvalRationale:
    string;
}

export const EMPTY_CAPA_SCOPE_REVIEW_DRAFT:
  CapaScopeReviewDraft = Object.freeze({
    problemStatement: "",
    what: "",
    where: "",
    when: "",
    extentDimension: "",
    detectionMethod: "",
    affectedScopeRows: "",
    includedScope: "",
    exclusionRows: "",
    magnitude: "",
    frequency: "",
    trend: "",
    affectedPopulation: "",
    priority: "",
    targetDateRows: "",
    applicabilityDecision: "",
    applicabilityRationale: "",
    sourceReference: "",
    evidenceReferences: "",
    unresolvedScopeGaps: "",
    escalationRows: "",
    approvalRationale: "",
  });

export interface CapaScopeReviewSubmission {
  readonly scope:
    CapaScopeContent;

  readonly approvalRationale:
    string;
}

export type BuildCapaScopeReviewSubmissionResult =
  | {
      readonly valid:
        true;

      readonly submission:
        CapaScopeReviewSubmission;
    }
  | {
      readonly valid:
        false;

      readonly field:
        keyof CapaScopeReviewDraft | "scope";

      readonly message:
        string;
    };

function trimmed(
  value: string,
): string {
  return value.trim();
}

function nullableText(
  value: string,
): string | null {
  const normalized =
    trimmed(value);

  return normalized.length === 0
    ? null
    : normalized;
}

function nonEmptyLines(
  value: string,
): readonly string[] {
  return Object.freeze(
    value
      .split(/\r?\n/)
      .map((item) =>
        item.trim(),
      )
      .filter((item) =>
        item.length > 0,
      ),
  );
}

function isElementType(
  value: string,
): value is CapaScopeElementType {
  return ELEMENT_TYPES.some(
    (candidate) =>
      candidate === value,
  );
}

function isEscalationStatus(
  value: string,
): value is CapaScopeEscalationStatus {
  return ESCALATION_STATUSES.some(
    (candidate) =>
      candidate === value,
  );
}

function isIsoDate(
  value: string,
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return false;
  }

  const parsed =
    new Date(
      `${value}T00:00:00.000Z`,
    );

  return (
    !Number.isNaN(
      parsed.getTime(),
    ) &&
    parsed
      .toISOString()
      .slice(0, 10) ===
      value
  );
}

function parsedAffectedScope(
  value: string,
):
  | readonly CapaScopeElement[]
  | null {
  const lines =
    nonEmptyLines(value);

  const result:
    CapaScopeElement[] = [];

  for (const line of lines) {
    const parts =
      line
        .split("|")
        .map((item) =>
          item.trim(),
        );

    if (
      parts.length !== 2
    ) {
      return null;
    }

    const [
      elementType,
      elementValue,
    ] = parts;

    if (
      elementType === undefined ||
      elementValue === undefined ||
      !isElementType(
        elementType,
      ) ||
      elementValue.length === 0
    ) {
      return null;
    }

    result.push(
      Object.freeze({
        element_type:
          elementType,

        value:
          elementValue,
      }),
    );
  }

  return Object.freeze(result);
}

function parsedExclusions(
  value: string,
):
  | readonly CapaScopeExclusion[]
  | null {
  const lines =
    nonEmptyLines(value);

  const result:
    CapaScopeExclusion[] = [];

  for (const line of lines) {
    const parts =
      line
        .split("|")
        .map((item) =>
          item.trim(),
        );

    if (
      parts.length !== 2
    ) {
      return null;
    }

    const [
      subject,
      rationale,
    ] = parts;

    if (
      subject === undefined ||
      rationale === undefined ||
      subject.length === 0 ||
      rationale.length === 0
    ) {
      return null;
    }

    result.push(
      Object.freeze({
        subject,
        rationale,
      }),
    );
  }

  return Object.freeze(result);
}

function parsedTargetDates(
  value: string,
):
  | readonly CapaScopeTargetDate[]
  | null {
  const lines =
    nonEmptyLines(value);

  const result:
    CapaScopeTargetDate[] = [];

  for (const line of lines) {
    const parts =
      line
        .split("|")
        .map((item) =>
          item.trim(),
        );

    if (
      parts.length !== 2
    ) {
      return null;
    }

    const [
      label,
      targetDate,
    ] = parts;

    if (
      label === undefined ||
      targetDate === undefined ||
      label.length === 0 ||
      !isIsoDate(
        targetDate,
      )
    ) {
      return null;
    }

    result.push(
      Object.freeze({
        label,
        target_date:
          targetDate,
      }),
    );
  }

  return Object.freeze(result);
}

function parsedEscalations(
  value: string,
):
  | readonly CapaScopeEscalation[]
  | null {
  const lines =
    nonEmptyLines(value);

  const result:
    CapaScopeEscalation[] = [];

  for (const line of lines) {
    const parts =
      line
        .split("|")
        .map((item) =>
          item.trim(),
        );

    if (
      parts.length !== 4
    ) {
      return null;
    }

    const [
      process,
      reference,
      status,
      rationale,
    ] = parts;

    if (
      process === undefined ||
      reference === undefined ||
      status === undefined ||
      rationale === undefined ||
      process.length === 0 ||
      reference.length === 0 ||
      rationale.length === 0 ||
      !isEscalationStatus(
        status,
      )
    ) {
      return null;
    }

    result.push(
      Object.freeze({
        process,
        reference,
        status,
        rationale,
      }),
    );
  }

  return Object.freeze(result);
}

export function buildCapaScopeReviewSubmission(
  draft:
    CapaScopeReviewDraft,
): BuildCapaScopeReviewSubmissionResult {
  const problemStatement =
    trimmed(
      draft.problemStatement,
    );

  if (
    problemStatement.length === 0
  ) {
    return {
      valid: false,
      field:
        "problemStatement",
      message:
        "Enter the human-authored CAPA problem statement.",
    };
  }

  const affectedScope =
    parsedAffectedScope(
      draft.affectedScopeRows,
    );

  if (
    affectedScope === null
  ) {
    return {
      valid: false,
      field:
        "affectedScopeRows",
      message:
        "Affected scope rows must use: type | value.",
    };
  }

  if (
    affectedScope.length === 0
  ) {
    return {
      valid: false,
      field:
        "affectedScopeRows",
      message:
        "Identify at least one affected product, process, site, supplier, system, or other scope element.",
    };
  }

  const includedScope =
    nonEmptyLines(
      draft.includedScope,
    );

  if (
    includedScope.length === 0
  ) {
    return {
      valid: false,
      field:
        "includedScope",
      message:
        "Identify at least one item that is explicitly included in CAPA scope.",
    };
  }

  const exclusions =
    parsedExclusions(
      draft.exclusionRows,
    );

  if (
    exclusions === null
  ) {
    return {
      valid: false,
      field:
        "exclusionRows",
      message:
        "Scope exclusions must use: subject | rationale.",
    };
  }

  const magnitude =
    nullableText(
      draft.magnitude,
    );
  const frequency =
    nullableText(
      draft.frequency,
    );
  const trend =
    nullableText(
      draft.trend,
    );
  const affectedPopulation =
    nullableText(
      draft.affectedPopulation,
    );

  if (
    magnitude === null &&
    frequency === null &&
    trend === null &&
    affectedPopulation === null
  ) {
    return {
      valid: false,
      field:
        "scope",
      message:
        "Document the known extent using magnitude, frequency, trend, or affected population.",
    };
  }

  const priority =
    trimmed(
      draft.priority,
    );

  if (
    priority.length === 0
  ) {
    return {
      valid: false,
      field:
        "priority",
      message:
        "Enter the organization-specific CAPA priority.",
    };
  }

  const targetDates =
    parsedTargetDates(
      draft.targetDateRows,
    );

  if (
    targetDates === null
  ) {
    return {
      valid: false,
      field:
        "targetDateRows",
      message:
        "Target dates must use: label | YYYY-MM-DD.",
    };
  }

  if (
    targetDates.length === 0
  ) {
    return {
      valid: false,
      field:
        "targetDateRows",
      message:
        "Enter at least one CAPA target date.",
    };
  }

  if (
    draft.applicabilityDecision !==
      "capa_applicable" &&
    draft.applicabilityDecision !==
      "capa_not_applicable"
  ) {
    return {
      valid: false,
      field:
        "applicabilityDecision",
      message:
        "The human reviewer must explicitly determine CAPA applicability before G-01 acceptance.",
    };
  }

  const applicabilityRationale =
    trimmed(
      draft.applicabilityRationale,
    );

  if (
    applicabilityRationale.length === 0
  ) {
    return {
      valid: false,
      field:
        "applicabilityRationale",
      message:
        "Document the human rationale for the CAPA applicability decision.",
    };
  }

  const sourceReference =
    trimmed(
      draft.sourceReference,
    );

  if (
    sourceReference.length === 0
  ) {
    return {
      valid: false,
      field:
        "sourceReference",
      message:
        "Enter the source reference supporting the scoped CAPA.",
    };
  }

  const unresolvedScopeGaps =
    nonEmptyLines(
      draft.unresolvedScopeGaps,
    );

  if (
    unresolvedScopeGaps.length > 0
  ) {
    return {
      valid: false,
      field:
        "unresolvedScopeGaps",
      message:
        "Resolve or remove all unresolved scope gaps before G-01 acceptance.",
    };
  }

  const escalations =
    parsedEscalations(
      draft.escalationRows,
    );

  if (
    escalations === null
  ) {
    return {
      valid: false,
      field:
        "escalationRows",
      message:
        "Required escalations must use: process | reference | open/resolved | rationale.",
    };
  }

  if (
    escalations.some(
      (item) =>
        item.status === "open",
    )
  ) {
    return {
      valid: false,
      field:
        "escalationRows",
      message:
        "Resolve every required escalation before G-01 scope acceptance.",
    };
  }

  const approvalRationale =
    trimmed(
      draft.approvalRationale,
    );

  if (
    approvalRationale.length === 0
  ) {
    return {
      valid: false,
      field:
        "approvalRationale",
      message:
        "Enter the human rationale for accepting this scope.",
    };
  }

  const scope:
    CapaScopeContent =
      Object.freeze({
        problem_statement:
          problemStatement,

        scope_dimensions:
          Object.freeze({
            what:
              nullableText(
                draft.what,
              ),

            where:
              nullableText(
                draft.where,
              ),

            when:
              nullableText(
                draft.when,
              ),

            extent:
              nullableText(
                draft.extentDimension,
              ),

            detection_method:
              nullableText(
                draft.detectionMethod,
              ),
          }),

        affected_scope_elements:
          affectedScope,

        included_scope:
          includedScope,

        exclusions,

        extent_summary:
          Object.freeze({
            magnitude,
            frequency,
            trend,

            affected_population:
              affectedPopulation,
          }),

        priority,

        target_dates:
          targetDates,

        applicability:
          Object.freeze({
            decision:
              draft.applicabilityDecision,

            rationale:
              applicabilityRationale,
          }),

        source_reference:
          sourceReference,

        evidence_references:
          nonEmptyLines(
            draft.evidenceReferences,
          ),

        unresolved_scope_gaps:
          unresolvedScopeGaps,

        required_escalations:
          escalations,
      });

  return {
    valid:
      true,

    submission:
      Object.freeze({
        scope,

        approvalRationale,
      }),
  };
}
