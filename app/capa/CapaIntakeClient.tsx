"use client";

import Link from "next/link";

import {
  parseCapaExistingCaseResponse,
  type CapaExistingCaseSummary,
} from "./capa-existing-case-client";

import {
  parseCapaIntakeAdvisorySnapshot,
  type CapaIntakeAdvisorySnapshot,
} from "./capa-intake-advisory-snapshot";

import {
  buildCapaAiOutputReviewRequest,
  createEmptyCapaAiOutputReviewDraft,
  parseCapaAiOutputReviewFailure,
  parseCapaAiOutputReviewSuccess,
  type CapaAiOutputReviewDecision,
  type CapaAiOutputReviewFailure,
  type CapaAiOutputReviewHumanRevision,
  type CapaAiOutputReviewSuccess,
} from "./capa-ai-output-review-client";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

const INPUT_LIMITS = {
  initiatingEvent: 4_000,
  sourceType: 64,
  sourceReference: 500,
  organizationReference: 100,
} as const;

const CONTROLLED_CODE_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]*$/;

const CASE_LIST_LIMIT = 10;

type WorkflowStep =
  | "edit"
  | "review"
  | "created";

interface CapaIntakeClientProps {
  readonly userEmail: string;
}

interface IntakeFields {
  readonly initiatingEvent: string;
  readonly sourceType: string;
  readonly sourceReference: string;
  readonly organizationReference: string;
}

interface CapaAiOutputReviewRevisionEditor {
  readonly problemStatement:
    string;

  readonly scopeDimensions:
    string;

  readonly missingDimensions:
    string;

  readonly containmentRiskQuestions:
    string;

  readonly investigationQuestions:
    string;
}

const EMPTY_AI_REVIEW_REVISION:
  CapaAiOutputReviewRevisionEditor = {
  problemStatement:
    "",

  scopeDimensions:
    "",

  missingDimensions:
    "",

  containmentRiskQuestions:
    "",

  investigationQuestions:
    "",
};

function normalizedReviewLines(
  value: string,
): readonly string[] {
  return value
    .split(/\r?\n/)
    .map(
      (item) =>
        item.trim(),
    )
    .filter(
      (item) =>
        item.length > 0,
    );
}

type FieldName = keyof IntakeFields;

type FieldErrors = Partial<
  Record<FieldName, string>
>;

type CreatedCapaSummary =
  CapaExistingCaseSummary;

interface ApiIssue {
  readonly path: string;
  readonly message: string;
}

interface ApiErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly correlation_id?: string;
    readonly issues?: readonly ApiIssue[];
  };
}

interface CreateCapaResponse {
  readonly capa?: {
    readonly capa_case_id?: string;
    readonly case_number?: string;
    readonly status?: string;
    readonly record_version?: number;
    readonly current_version_id?: string;
    readonly section_version_id?: string;
    readonly created_at?: string;
  };
  readonly correlation_id?: string;
}

interface RetrievedCapaResponse {
  readonly capa?: {
    readonly capa_case_id?: string;
    readonly case_number?: string;
    readonly status?: string;
    readonly record_version?: number;
    readonly current_version_id?: string;
    readonly created_at?: string;
    readonly sections?: readonly {
      readonly section_version_id?: string;
      readonly content?: {
        readonly initiating_event?: string;
        readonly source?: {
          readonly source_type?: string;
          readonly source_reference?: string;
        };
        readonly organization_reference?: string;
      };
    }[];
  };
  readonly correlation_id?: string;
}

interface CapaListItem {
  readonly capaCaseId: string;
  readonly caseNumber: string;
  readonly status: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SubmitIntakeResponse {
  readonly capa?: {
    readonly capa_case_id?: string;
    readonly case_number?: string;
    readonly status?: string;
    readonly record_version?: number;
    readonly current_version_id?: string;
    readonly submitted_version_id?: string;
    readonly submitted_at?: string;
    readonly audit_event_id?: string;
  };
  readonly replayed?: boolean;
  readonly correlation_id?: string;
}

interface WorkflowSubmissionTarget {
  readonly capaCaseId: string;
  readonly caseNumber: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly idempotencyKey: string;
}

interface CapaListCursor {
  readonly createdAt: string;
  readonly capaCaseId: string;
}

interface ParsedCapaListPage {
  readonly cases:
    readonly CapaListItem[];
  readonly nextCursor?:
    CapaListCursor;
}

interface CapaIntakeAdvisoryProposal {
  readonly problem_statement_draft:
    string;

  readonly scope_dimensions:
    readonly string[];

  readonly missing_dimensions:
    readonly string[];

  readonly containment_risk_questions:
    readonly string[];

  readonly investigation_questions:
    readonly string[];
}

interface CapaIntakeAdvisoryCitation {
  readonly citation_id:
    string;

  readonly rendered_label:
    string;

  readonly source_title:
    string;

  readonly precise_locator:
    string;

  readonly relationship:
    string;

  readonly validation_status:
    string;
}

interface CapaIntakeAdvisoryResult {
  readonly run_id:
    string;

  readonly output_id:
    string;

  readonly output_schema_version:
    string;

  readonly status:
    string;

  readonly proposal:
    CapaIntakeAdvisoryProposal | null;

  readonly citations:
    readonly CapaIntakeAdvisoryCitation[];

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

  readonly warnings:
    readonly string[];

  readonly advisory_only:
    true;

  readonly workflow_mutated:
    false;

  readonly human_acceptance_required:
    true;
}

interface CapaIntakeAdvisoryApiResponse {
  readonly advisory?:
    CapaIntakeAdvisoryResult;

  readonly snapshot?:
    unknown;

  readonly correlation_id?:
    string;
}

interface ParsedCapaIntakeAdvisoryResponse {
  readonly advisory:
    CapaIntakeAdvisoryResult;

  readonly snapshot:
    CapaIntakeAdvisorySnapshot;
}

const EMPTY_FIELDS: IntakeFields = {
  initiatingEvent: "",
  sourceType: "",
  sourceReference: "",
  organizationReference: "",
};

function createTraceId(): string {
  return crypto.randomUUID();
}

async function readJson(
  response: Response,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function stringArray(
  value: unknown,
): readonly string[] | null {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "string",
    )
  ) {
    return null;
  }

  return value;
}

function parsedAdvisoryProposal(
  value: unknown,
): CapaIntakeAdvisoryProposal | null | undefined {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const scopeDimensions =
    stringArray(
      value.scope_dimensions,
    );

  const missingDimensions =
    stringArray(
      value.missing_dimensions,
    );

  const containmentQuestions =
    stringArray(
      value.containment_risk_questions,
    );

  const investigationQuestions =
    stringArray(
      value.investigation_questions,
    );

  if (
    typeof value.problem_statement_draft !==
      "string" ||
    scopeDimensions === null ||
    missingDimensions === null ||
    containmentQuestions === null ||
    investigationQuestions === null
  ) {
    return undefined;
  }

  return {
    problem_statement_draft:
      value.problem_statement_draft,

    scope_dimensions:
      scopeDimensions,

    missing_dimensions:
      missingDimensions,

    containment_risk_questions:
      containmentQuestions,

    investigation_questions:
      investigationQuestions,
  };
}

function parsedAdvisoryCitations(
  value: unknown,
): readonly CapaIntakeAdvisoryCitation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const citations:
    CapaIntakeAdvisoryCitation[] = [];

  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.citation_id !== "string" ||
      typeof item.rendered_label !== "string" ||
      typeof item.source_title !== "string" ||
      typeof item.precise_locator !== "string" ||
      typeof item.relationship !== "string" ||
      typeof item.validation_status !== "string"
    ) {
      return null;
    }

    citations.push({
      citation_id:
        item.citation_id,

      rendered_label:
        item.rendered_label,

      source_title:
        item.source_title,

      precise_locator:
        item.precise_locator,

      relationship:
        item.relationship,

      validation_status:
        item.validation_status,
    });
  }

  return citations;
}

function parsedIntakeAdvisoryResponse(
  value: unknown,
): ParsedCapaIntakeAdvisoryResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const response =
    value as CapaIntakeAdvisoryApiResponse;

  const advisory =
    response.advisory;

  const snapshot =
    parseCapaIntakeAdvisorySnapshot(
      response.snapshot,
    );

  if (
    !isRecord(advisory) ||
    snapshot === null
  ) {
    return null;
  }

  const proposal =
    parsedAdvisoryProposal(
      advisory.proposal,
    );

  const citations =
    parsedAdvisoryCitations(
      advisory.citations,
    );

  const assumptions =
    stringArray(
      advisory.assumptions,
    );

  const missingInformation =
    stringArray(
      advisory.missing_information,
    );

  const conflicts =
    stringArray(
      advisory.conflicts_and_alternatives,
    );

  const uncertainty =
    stringArray(
      advisory.uncertainty_and_limitations,
    );

  const humanAction =
    stringArray(
      advisory.human_action_required,
    );

  const warnings =
    stringArray(
      advisory.warnings,
    );

  if (
    typeof advisory.run_id !== "string" ||
    typeof advisory.output_id !== "string" ||
    typeof advisory.output_schema_version !==
      "string" ||
    typeof advisory.status !== "string" ||
    proposal === undefined ||
    citations === null ||
    assumptions === null ||
    missingInformation === null ||
    conflicts === null ||
    uncertainty === null ||
    humanAction === null ||
    warnings === null ||
    advisory.advisory_only !== true ||
    advisory.workflow_mutated !== false ||
    advisory.human_acceptance_required !==
      true
  ) {
    return null;
  }

  const parsedAdvisory:
    CapaIntakeAdvisoryResult = {
    run_id:
      advisory.run_id,

    output_id:
      advisory.output_id,

    output_schema_version:
      advisory.output_schema_version,

    status:
      advisory.status,

    proposal,

    citations,

    assumptions,

    missing_information:
      missingInformation,

    conflicts_and_alternatives:
      conflicts,

    uncertainty_and_limitations:
      uncertainty,

    human_action_required:
      humanAction,

    warnings,

    advisory_only:
      true,

    workflow_mutated:
      false,

    human_acceptance_required:
      true,
  };

  return {
    advisory:
      parsedAdvisory,

    snapshot,
  };
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

function apiErrorMessage(
  value: unknown,
  fallback: string,
): string {
  if (!isRecord(value)) {
    return fallback;
  }

  const error = value.error;

  if (!isRecord(error)) {
    return fallback;
  }

  return typeof error.message === "string"
    ? error.message
    : fallback;
}

function apiIssues(
  value: unknown,
): readonly ApiIssue[] {
  if (!isRecord(value)) {
    return [];
  }

  const error = value.error;

  if (
    !isRecord(error) ||
    !Array.isArray(error.issues)
  ) {
    return [];
  }

  return error.issues.filter(
    (issue): issue is ApiIssue =>
      isRecord(issue) &&
      typeof issue.path === "string" &&
      typeof issue.message === "string",
  );
}

function parsedCapaListPage(
  value: unknown,
): ParsedCapaListPage | null {
  if (
    !isRecord(value) ||
    !Array.isArray(
      value.capa_cases,
    )
  ) {
    return null;
  }

  const cases:
    CapaListItem[] = [];

  for (const item of
    value.capa_cases) {
    if (
      !isRecord(item) ||
      typeof item.capa_case_id !==
        "string" ||
      typeof item.case_number !==
        "string" ||
      typeof item.status !==
        "string" ||
      typeof item.record_version !==
        "number" ||
      typeof item.current_version_id !==
        "string" ||
      typeof item.created_at !==
        "string" ||
      typeof item.updated_at !==
        "string"
    ) {
      return null;
    }

    cases.push({
      capaCaseId:
        item.capa_case_id,
      caseNumber:
        item.case_number,
      status:
        item.status,
      recordVersion:
        item.record_version,
      currentVersionId:
        item.current_version_id,
      createdAt:
        item.created_at,
      updatedAt:
        item.updated_at,
    });
  }

  if (
    value.next_cursor ===
    undefined
  ) {
    return { cases };
  }

  if (
    !isRecord(value.next_cursor) ||
    typeof value.next_cursor
      .created_at !== "string" ||
    typeof value.next_cursor
      .capa_case_id !== "string"
  ) {
    return null;
  }

  return {
    cases,
    nextCursor: {
      createdAt:
        value.next_cursor
          .created_at,
      capaCaseId:
        value.next_cursor
          .capa_case_id,
    },
  };
}

function normalizedFields(
  fields: IntakeFields,
): IntakeFields {
  return {
    initiatingEvent:
      fields.initiatingEvent.trim(),
    sourceType:
      fields.sourceType.trim(),
    sourceReference:
      fields.sourceReference.trim(),
    organizationReference:
      fields.organizationReference.trim(),
  };
}

function validateFields(
  fields: IntakeFields,
): FieldErrors {
  const values = normalizedFields(fields);
  const errors: FieldErrors = {};

  if (!values.initiatingEvent) {
    errors.initiatingEvent =
      "Initiating event is required.";
  } else if (
    values.initiatingEvent.length >
    INPUT_LIMITS.initiatingEvent
  ) {
    errors.initiatingEvent =
      "Initiating event exceeds 4,000 characters.";
  }

  if (!values.sourceType) {
    errors.sourceType =
      "Source type is required.";
  } else if (
    values.sourceType.length >
    INPUT_LIMITS.sourceType
  ) {
    errors.sourceType =
      "Source type exceeds 64 characters.";
  } else if (
    !CONTROLLED_CODE_PATTERN.test(
      values.sourceType,
    )
  ) {
    errors.sourceType =
      "Use a controlled code such as NONCONFORMANCE or AUDIT_FINDING.";
  }

  if (
    values.sourceReference.length >
    INPUT_LIMITS.sourceReference
  ) {
    errors.sourceReference =
      "Source reference exceeds 500 characters.";
  }

  if (
    values.organizationReference.length >
    INPUT_LIMITS.organizationReference
  ) {
    errors.organizationReference =
      "Organization reference exceeds 100 characters.";
  }

  return errors;
}

function mapApiIssues(
  issues: readonly ApiIssue[],
): FieldErrors {
  const errors: FieldErrors = {};

  for (const issue of issues) {
    if (
      issue.path === "initiating_event"
    ) {
      errors.initiatingEvent =
        issue.message;
    } else if (
      issue.path === "source.source_type"
    ) {
      errors.sourceType =
        issue.message;
    } else if (
      issue.path ===
      "source.source_reference"
    ) {
      errors.sourceReference =
        issue.message;
    } else if (
      issue.path ===
      "organization_reference"
    ) {
      errors.organizationReference =
        issue.message;
    }
  }

  return errors;
}

function formattedDate(
  value: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

function statusName(
  status: string,
): string {
  if (status === "S00") {
    return "Draft Intake";
  }

  return status === "S10"
    ? "Intake Submitted"
    : status;
}

export default function CapaIntakeClient({
  userEmail,
}: CapaIntakeClientProps) {
  const [step, setStep] =
    useState<WorkflowStep>("edit");

  const [fields, setFields] =
    useState<IntakeFields>(
      EMPTY_FIELDS,
    );

  const [errors, setErrors] =
    useState<FieldErrors>({});

  const [submitError, setSubmitError] =
    useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [createdCapa, setCreatedCapa] =
    useState<CreatedCapaSummary | null>(
      null,
    );

  const [listedCases, setListedCases] =
    useState<readonly CapaListItem[]>(
      [],
    );

  const [nextListCursor, setNextListCursor] =
    useState<CapaListCursor | null>(
      null,
    );

  const [isLoadingCases, setIsLoadingCases] =
    useState(true);

  const [isLoadingMoreCases, setIsLoadingMoreCases] =
    useState(false);

  const [caseListError, setCaseListError] =
    useState<string | null>(null);

  const [openingCaseId, setOpeningCaseId] =
    useState<string | null>(null);

  const [openCaseError, setOpenCaseError] =
    useState<string | null>(null);

  const [workflowSubmission, setWorkflowSubmission] =
    useState<WorkflowSubmissionTarget | null>(null);

  const [workflowSubmissionConfirmed, setWorkflowSubmissionConfirmed] =
    useState(false);

  const [isSubmittingIntake, setIsSubmittingIntake] =
    useState(false);

  const [workflowSubmissionError, setWorkflowSubmissionError] =
    useState<string | null>(null);

  const [workflowSubmissionMessage, setWorkflowSubmissionMessage] =
    useState<string | null>(null);

  const [advisoryFocus, setAdvisoryFocus] =
    useState("");

  const [intakeAdvisory, setIntakeAdvisory] =
    useState<CapaIntakeAdvisoryResult | null>(
      null,
    );

  const [advisorySnapshot, setAdvisorySnapshot] =
    useState<CapaIntakeAdvisorySnapshot | null>(
      null,
    );

  const [isRequestingAdvisory, setIsRequestingAdvisory] =
    useState(false);

  const [advisoryError, setAdvisoryError] =
    useState<string | null>(null);

  const [advisoryCorrelationId, setAdvisoryCorrelationId] =
    useState<string | null>(null);

  const [reviewDecision, setReviewDecision] =
    useState<CapaAiOutputReviewDecision | null>(
      null,
    );

  const [reviewRationale, setReviewRationale] =
    useState("");

  const [reviewRevisionEditor, setReviewRevisionEditor] =
    useState<CapaAiOutputReviewRevisionEditor>(
      EMPTY_AI_REVIEW_REVISION,
    );

  const [reviewIdempotencyKey, setReviewIdempotencyKey] =
    useState<string | null>(
      null,
    );

  const [isSubmittingReview, setIsSubmittingReview] =
    useState(false);

  const [reviewResult, setReviewResult] =
    useState<CapaAiOutputReviewSuccess | null>(
      null,
    );

  const [reviewFailure, setReviewFailure] =
    useState<CapaAiOutputReviewFailure | null>(
      null,
    );

  const [
    reviewConfirmationOpen,
    setReviewConfirmationOpen,
  ] = useState(false);

  const [
    reviewConfirmationConfirmed,
    setReviewConfirmationConfirmed,
  ] = useState(false);

  const loadCases = useCallback(
    async (
      mode: "replace" | "append",
      cursor?: CapaListCursor,
    ) => {
      if (mode === "replace") {
        setIsLoadingCases(true);
      } else {
        setIsLoadingMoreCases(true);
      }

      setCaseListError(null);

      try {
        const parameters =
          new URLSearchParams({
            limit:
              String(CASE_LIST_LIMIT),
          });

        if (cursor !== undefined) {
          parameters.set(
            "cursor_created_at",
            cursor.createdAt,
          );
          parameters.set(
            "cursor_case_id",
            cursor.capaCaseId,
          );
        }

        const response = await fetch(
          `/api/capa?${parameters.toString()}`,
          {
            method: "GET",
            headers: {
              "x-request-id":
                createTraceId(),
              "x-correlation-id":
                createTraceId(),
            },
            cache: "no-store",
          },
        );

        const body =
          await readJson(response);

        if (!response.ok) {
          throw new Error(
            apiErrorMessage(
              body,
              "The CAPA workspace could not be loaded.",
            ),
          );
        }

        const page =
          parsedCapaListPage(body);

        if (page === null) {
          throw new Error(
            "The server returned an incomplete CAPA case list.",
          );
        }

        setListedCases((current) => {
          if (mode === "replace") {
            return page.cases;
          }

          const combined = new Map(
            current.map((item) => [
              item.capaCaseId,
              item,
            ]),
          );

          for (const item of
            page.cases) {
            combined.set(
              item.capaCaseId,
              item,
            );
          }

          return [
            ...combined.values(),
          ];
        });

        setNextListCursor(
          page.nextCursor ?? null,
        );
      } catch (error) {
        setCaseListError(
          error instanceof Error
            ? error.message
            : "The CAPA workspace could not be loaded.",
        );
      } finally {
        if (mode === "replace") {
          setIsLoadingCases(false);
        } else {
          setIsLoadingMoreCases(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadCases("replace");
  }, [loadCases]);

  const charactersRemaining =
    INPUT_LIMITS.initiatingEvent -
    fields.initiatingEvent.length;

  const canReview = useMemo(
    () =>
      fields.initiatingEvent.trim()
        .length > 0 &&
      fields.sourceType.trim().length > 0,
    [
      fields.initiatingEvent,
      fields.sourceType,
    ],
  );

  function updateField(
    field: FieldName,
    value: string,
  ) {
    setFields((current) => ({
      ...current,
      [field]: value,
    }));

    setErrors((current) => {
      if (current[field] === undefined) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });

    setSubmitError(null);
  }

  function proceedToReview(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const validationErrors =
      validateFields(fields);

    setErrors(validationErrors);
    setSubmitError(null);

    if (
      Object.keys(validationErrors)
        .length > 0
    ) {
      return;
    }

    setFields(normalizedFields(fields));
    setStep("review");
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function submitCapa() {
    if (isSubmitting) {
      return;
    }

    const validationErrors =
      validateFields(fields);

    if (
      Object.keys(validationErrors)
        .length > 0
    ) {
      setErrors(validationErrors);
      setStep("edit");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const requestId = createTraceId();
    const correlationId = createTraceId();
    const idempotencyKey =
      createTraceId();

    const values =
      normalizedFields(fields);

    const requestBody = {
      initiating_event:
        values.initiatingEvent,

      source: {
        source_type:
          values.sourceType,

        ...(values.sourceReference
          ? {
              source_reference:
                values.sourceReference,
            }
          : {}),
      },

      ...(values.organizationReference
        ? {
            organization_reference:
              values.organizationReference,
          }
        : {}),
    };

    try {
      const createResponse = await fetch(
        "/api/capa",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
            "x-request-id": requestId,
            "x-correlation-id":
              correlationId,
            "idempotency-key":
              idempotencyKey,
          },
          body: JSON.stringify(
            requestBody,
          ),
        },
      );

      const createBody =
        await readJson(createResponse);

      if (!createResponse.ok) {
        const issues =
          apiIssues(createBody);

        if (issues.length > 0) {
          setErrors(
            mapApiIssues(issues),
          );
          setStep("edit");
        }

        throw new Error(
          apiErrorMessage(
            createBody,
            "The CAPA draft could not be created.",
          ),
        );
      }

      const created =
        createBody as
          CreateCapaResponse;

      const capa = created.capa;

      if (
        capa === undefined ||
        typeof capa.capa_case_id !==
          "string" ||
        typeof capa.case_number !==
          "string" ||
        typeof capa.status !==
          "string" ||
        typeof capa.record_version !==
          "number" ||
        typeof capa.current_version_id !==
          "string" ||
        typeof capa.section_version_id !==
          "string" ||
        typeof capa.created_at !==
          "string"
      ) {
        throw new Error(
          "The server returned an incomplete CAPA creation response.",
        );
      }

      let retrievalVerified = false;
      let verifiedInitiatingEvent =
        values.initiatingEvent;

      let verifiedSourceType =
        values.sourceType;

      let verifiedSourceReference =
        values.sourceReference ||
        undefined;

      let verifiedOrganizationReference =
        values.organizationReference ||
        undefined;

      const retrievalResponse =
        await fetch(
          `/api/capa?id=${encodeURIComponent(
            capa.capa_case_id,
          )}`,
          {
            method: "GET",
            headers: {
              "x-request-id":
                createTraceId(),
              "x-correlation-id":
                correlationId,
            },
            cache: "no-store",
          },
        );

      if (retrievalResponse.ok) {
        const retrievalBody =
          (await readJson(
            retrievalResponse,
          )) as RetrievedCapaResponse;

        const retrieved =
          retrievalBody.capa;

        const intakeSection =
          retrieved?.sections?.[0];

        if (
          retrieved?.capa_case_id ===
            capa.capa_case_id &&
          intakeSection?.content
            ?.initiating_event
        ) {
          retrievalVerified = true;

          verifiedInitiatingEvent =
            intakeSection.content
              .initiating_event;

          verifiedSourceType =
            intakeSection.content.source
              ?.source_type ??
            values.sourceType;

          verifiedSourceReference =
            intakeSection.content.source
              ?.source_reference;

          verifiedOrganizationReference =
            intakeSection.content
              .organization_reference;
        }
      }

      setCreatedCapa({
        capaCaseId:
          capa.capa_case_id,
        caseNumber:
          capa.case_number,
        status:
          capa.status,
        recordVersion:
          capa.record_version,
        currentVersionId:
          capa.current_version_id,
        sectionVersionId:
          capa.section_version_id,
        createdAt:
          capa.created_at,
        initiatingEvent:
          verifiedInitiatingEvent,
        sourceType:
          verifiedSourceType,
        sourceReference:
          verifiedSourceReference,
        organizationReference:
          verifiedOrganizationReference,
        correlationId:
          created.correlation_id ??
          correlationId,
        retrievalVerified,
      });

      setStep("created");

      void loadCases("replace");

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "The CAPA draft could not be created.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openExistingCase(
    capaCase: CapaListItem,
  ) {
    if (
      openingCaseId !== null ||
      isSubmittingIntake ||
      isRequestingAdvisory ||
      isSubmittingReview
    ) {
      return;
    }

    setOpeningCaseId(
      capaCase.capaCaseId,
    );
    setOpenCaseError(null);

    const correlationId =
      createTraceId();

    try {
      const response = await fetch(
        `/api/capa?id=${encodeURIComponent(
          capaCase.capaCaseId,
        )}`,
        {
          method: "GET",
          headers: {
            "x-request-id":
              createTraceId(),
            "x-correlation-id":
              correlationId,
          },
          cache: "no-store",
        },
      );

      const body =
        await readJson(response);

      if (!response.ok) {
        throw new Error(
          apiErrorMessage(
            body,
            "The CAPA case could not be opened.",
          ),
        );
      }

      const parsedCase =
        parseCapaExistingCaseResponse(
          body,
          {
            expectedCaseId:
              capaCase.capaCaseId,
            fallbackCorrelationId:
              correlationId,
          },
        );

      if (parsedCase === null) {
        throw new Error(
          "The server returned an incomplete CAPA case representation.",
        );
      }

      setCreatedCapa(
        parsedCase,
      );

      /*
       * Never carry an advisory or human-review attempt from one
       * CAPA case into another case view.
       */
      setAdvisoryFocus("");
      setIntakeAdvisory(null);
      setAdvisorySnapshot(null);
      setAdvisoryError(null);
      setAdvisoryCorrelationId(null);
      resetAiOutputReviewState();

      setStep("created");

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (error) {
      setOpenCaseError(
        error instanceof Error
          ? error.message
          : "The CAPA case could not be opened.",
      );
    } finally {
      setOpeningCaseId(null);
    }
  }

  function beginIntakeSubmission(
    capaCase: Pick<
      CapaListItem,
      | "capaCaseId"
      | "caseNumber"
      | "recordVersion"
      | "currentVersionId"
    >,
  ) {
    setWorkflowSubmission({
      ...capaCase,
      idempotencyKey: createTraceId(),
    });
    setWorkflowSubmissionConfirmed(false);
    setWorkflowSubmissionError(null);
    setWorkflowSubmissionMessage(null);
  }

  function cancelIntakeSubmission() {
    if (isSubmittingIntake) {
      return;
    }

    setWorkflowSubmission(null);
    setWorkflowSubmissionConfirmed(false);
    setWorkflowSubmissionError(null);
  }

  async function submitIntake() {
    const target = workflowSubmission;

    if (
      target === null ||
      isSubmittingIntake ||
      !workflowSubmissionConfirmed
    ) {
      return;
    }

    setIsSubmittingIntake(true);
    setWorkflowSubmissionError(null);

    const correlationId = createTraceId();

    try {
      const response = await fetch(
        "/api/capa/" +
          encodeURIComponent(
            target.capaCaseId,
          ) +
          "/submit-intake",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
            "x-request-id":
              createTraceId(),
            "x-correlation-id":
              correlationId,
            "idempotency-key":
              target.idempotencyKey,
          },
          body: JSON.stringify({
            expected_record_version:
              target.recordVersion,
            expected_current_version_id:
              target.currentVersionId,
          }),
        },
      );

      const body = await readJson(response);

      if (!response.ok) {
        throw new Error(
          apiErrorMessage(
            body,
            "The CAPA intake could not be submitted.",
          ),
        );
      }

      const submitted =
        body as SubmitIntakeResponse;
      const capa = submitted.capa;

      if (
        capa === undefined ||
        typeof capa.capa_case_id !== "string" ||
        typeof capa.case_number !== "string" ||
        capa.status !== "S10" ||
        typeof capa.record_version !== "number" ||
        typeof capa.current_version_id !== "string" ||
        typeof capa.submitted_version_id !== "string" ||
        typeof capa.submitted_at !== "string" ||
        typeof capa.audit_event_id !== "string" ||
        typeof submitted.replayed !== "boolean"
      ) {
        throw new Error(
          "The server returned an incomplete CAPA intake-submission response.",
        );
      }

      /*
       * Capture the validated response values before entering React state
       * callbacks. This preserves TypeScript's runtime-validation narrowing
       * across the callback boundary.
       */
      const submittedCaseId =
        capa.capa_case_id;
      const submittedCaseNumber =
        capa.case_number;
      const submittedStatus =
        capa.status;
      const submittedRecordVersion =
        capa.record_version;
      const submittedCurrentVersionId =
        capa.current_version_id;
      const submittedAt =
        capa.submitted_at;

      setListedCases((current) =>
        current.map((item) =>
          item.capaCaseId === submittedCaseId
            ? {
                ...item,
                caseNumber:
                  submittedCaseNumber,
                status:
                  submittedStatus,
                recordVersion:
                  submittedRecordVersion,
                currentVersionId:
                  submittedCurrentVersionId,
                updatedAt:
                  submittedAt,
              }
            : item,
        ),
      );

      setCreatedCapa((current) =>
        current?.capaCaseId === submittedCaseId
          ? {
              ...current,
              status:
                submittedStatus,
              recordVersion:
                submittedRecordVersion,
              currentVersionId:
                submittedCurrentVersionId,
            }
          : current,
      );

      setWorkflowSubmissionMessage(
        submitted.replayed
          ? submittedCaseNumber +
              " was already submitted. The authoritative S10 record was loaded."
          : submittedCaseNumber +
              " intake was submitted successfully.",
      );
      setWorkflowSubmission(null);
      setWorkflowSubmissionConfirmed(false);

      void loadCases("replace");
    } catch (error) {
      setWorkflowSubmissionError(
        error instanceof Error
          ? error.message
          : "The CAPA intake could not be submitted.",
      );
    } finally {
      setIsSubmittingIntake(false);
    }
  }

  function resetAiOutputReviewState() {
    setReviewDecision(
      createEmptyCapaAiOutputReviewDraft()
        .decision,
    );

    setReviewRationale("");
    setReviewRevisionEditor(
      EMPTY_AI_REVIEW_REVISION,
    );

    setReviewIdempotencyKey(null);
    setIsSubmittingReview(false);
    setReviewResult(null);
    setReviewFailure(null);
    setReviewConfirmationOpen(false);
    setReviewConfirmationConfirmed(false);
  }

  function invalidateAiOutputReviewAttempt() {
    setReviewIdempotencyKey(null);
    setReviewFailure(null);
    setReviewConfirmationOpen(false);
    setReviewConfirmationConfirmed(false);
  }

  function selectAiOutputReviewDecision(
    decision:
      CapaAiOutputReviewDecision,
  ) {
    if (reviewResult !== null) {
      return;
    }

    setReviewDecision(
      decision,
    );

    if (decision !== "revise") {
      setReviewRevisionEditor(
        EMPTY_AI_REVIEW_REVISION,
      );
    }

    invalidateAiOutputReviewAttempt();
  }

  function updateReviewRationale(
    value: string,
  ) {
    if (reviewResult !== null) {
      return;
    }

    setReviewRationale(
      value,
    );

    invalidateAiOutputReviewAttempt();
  }

  function updateReviewRevisionField(
    field:
      keyof CapaAiOutputReviewRevisionEditor,
    value:
      string,
  ) {
    if (reviewResult !== null) {
      return;
    }

    setReviewRevisionEditor(
      (current) => ({
        ...current,
        [field]:
          value,
      }),
    );

    invalidateAiOutputReviewAttempt();
  }

  function humanRevisionFromEditor():
    CapaAiOutputReviewHumanRevision {
    return {
      problem_statement_draft:
        reviewRevisionEditor
          .problemStatement
          .trim(),

      scope_dimensions:
        normalizedReviewLines(
          reviewRevisionEditor
            .scopeDimensions,
        ),

      missing_dimensions:
        normalizedReviewLines(
          reviewRevisionEditor
            .missingDimensions,
        ),

      containment_risk_questions:
        normalizedReviewLines(
          reviewRevisionEditor
            .containmentRiskQuestions,
        ),

      investigation_questions:
        normalizedReviewLines(
          reviewRevisionEditor
            .investigationQuestions,
        ),
    };
  }

  function reviewFailureGuidance(
    failure:
      CapaAiOutputReviewFailure,
  ): string {
    switch (failure.kind) {
      case "authorization_denied":
        return "Your current role is not authorized to record this human review. No review was committed.";

      case "authentication":
        return "Your authenticated CAPA session is no longer valid. No review was committed.";

      case "not_found":
        return "The governed AI output is unavailable for review. No review was committed.";

      case "not_reviewable":
        return "This governed AI output cannot be reviewed in its current persisted state. No review was committed.";

      case "stale":
        return "The CAPA changed after this AI advisory was generated. Generate a fresh governed analysis before reviewing it.";

      case "idempotency_conflict":
        return "The immutable request key conflicted with different review content. Do not assume a review was recorded.";

      case "invalid_request":
        return "Correct the review information and submit again.";

      case "unexpected":
        return "The review result could not be verified. Do not assume a review was recorded.";
    }
  }

  function reviewFailureBlocksRetry(
    failure:
      CapaAiOutputReviewFailure | null,
  ): boolean {
    if (failure === null) {
      return false;
    }

    return (
      failure.kind ===
        "authorization_denied" ||
      failure.kind ===
        "authentication" ||
      failure.kind ===
        "not_found" ||
      failure.kind ===
        "not_reviewable" ||
      failure.kind ===
        "stale" ||
      failure.kind ===
        "idempotency_conflict"
    );
  }

  function beginAiOutputReviewConfirmation() {
    if (
      createdCapa === null ||
      intakeAdvisory === null ||
      advisorySnapshot === null ||
      isSubmittingReview ||
      isRequestingAdvisory ||
      reviewResult !== null ||
      reviewFailureBlocksRetry(
        reviewFailure,
      )
    ) {
      return;
    }

    if (
      advisorySnapshot.capaCaseId !==
        createdCapa.capaCaseId
    ) {
      setReviewFailure({
        kind:
          "invalid_request",

        message:
          "The displayed AI advisory is not bound to this CAPA case.",

        correlationId:
          null,
      });

      return;
    }

    const humanRevision =
      reviewDecision === "revise"
        ? humanRevisionFromEditor()
        : null;

    const builtRequest =
      buildCapaAiOutputReviewRequest(
        {
          decision:
            reviewDecision,

          rationale:
            reviewRationale,

          humanRevision,
        },
        advisorySnapshot,
      );

    if (!builtRequest.valid) {
      setReviewFailure({
        kind:
          "invalid_request",

        message:
          builtRequest.issue.message,

        correlationId:
          null,
      });

      return;
    }

    setReviewFailure(null);
    setReviewConfirmationConfirmed(false);
    setReviewConfirmationOpen(true);
  }

  function cancelAiOutputReviewConfirmation() {
    if (isSubmittingReview) {
      return;
    }

    setReviewConfirmationOpen(false);
    setReviewConfirmationConfirmed(false);
  }

  async function submitAiOutputReview() {
    if (
      createdCapa === null ||
      intakeAdvisory === null ||
      advisorySnapshot === null ||
      isSubmittingReview ||
      isRequestingAdvisory ||
      reviewResult !== null ||
      !reviewConfirmationOpen ||
      !reviewConfirmationConfirmed ||
      reviewFailureBlocksRetry(
        reviewFailure,
      )
    ) {
      return;
    }

    if (
      advisorySnapshot.capaCaseId !==
        createdCapa.capaCaseId
    ) {
      setReviewFailure({
        kind:
          "invalid_request",

        message:
          "The displayed AI advisory is not bound to this CAPA case.",

        correlationId:
          null,
      });

      return;
    }

    const humanRevision =
      reviewDecision === "revise"
        ? humanRevisionFromEditor()
        : null;

    const builtRequest =
      buildCapaAiOutputReviewRequest(
        {
          decision:
            reviewDecision,

          rationale:
            reviewRationale,

          humanRevision,
        },
        advisorySnapshot,
      );

    if (!builtRequest.valid) {
      setReviewFailure({
        kind:
          "invalid_request",

        message:
          builtRequest.issue.message,

        correlationId:
          null,
      });

      return;
    }

    const idempotencyKey =
      reviewIdempotencyKey ??
      createTraceId();

    if (
      reviewIdempotencyKey === null
    ) {
      setReviewIdempotencyKey(
        idempotencyKey,
      );
    }

    const correlationId =
      createTraceId();

    setIsSubmittingReview(true);
    setReviewFailure(null);

    try {
      const response =
        await fetch(
          "/api/capa/" +
            encodeURIComponent(
              createdCapa.capaCaseId,
            ) +
            "/intake-advisory/" +
            encodeURIComponent(
              intakeAdvisory.output_id,
            ) +
            "/review",
          {
            method:
              "POST",

            headers: {
              "content-type":
                "application/json",

              "x-request-id":
                createTraceId(),

              "x-correlation-id":
                correlationId,

              "Idempotency-Key":
                idempotencyKey,
            },

            body:
              JSON.stringify(
                builtRequest.request,
              ),
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        setReviewFailure(
          parseCapaAiOutputReviewFailure(
            response.status,
            body,
          ),
        );

        return;
      }

      const parsed =
        parseCapaAiOutputReviewSuccess(
          body,
          {
            capaCaseId:
              createdCapa.capaCaseId,

            outputId:
              intakeAdvisory.output_id,

            snapshot:
              advisorySnapshot,
          },
        );

      if (parsed === null) {
        setReviewFailure({
          kind:
            "unexpected",

          message:
            "The server returned an unverifiable CAPA AI-output review response.",

          correlationId:
            correlationId,
        });

        return;
      }

      if (
        parsed.decision !==
          builtRequest.request.decision
      ) {
        setReviewFailure({
          kind:
            "unexpected",

          message:
            "The recorded review disposition did not match the submitted human disposition.",

          correlationId:
            parsed.correlationId,
        });

        return;
      }

      setReviewResult(
        parsed,
      );

      setReviewFailure(null);
    } catch {
      setReviewFailure({
        kind:
          "unexpected",

        message:
          "The CAPA AI-output review could not be recorded or verified.",

        correlationId,
      });
    } finally {
      setIsSubmittingReview(false);
      setReviewConfirmationOpen(false);
      setReviewConfirmationConfirmed(false);
    }
  }

  async function requestIntakeAdvisory() {
    if (
      createdCapa === null ||
      createdCapa.status !== "S10" ||
      isRequestingAdvisory ||
      isSubmittingReview
    ) {
      return;
    }

    setIsRequestingAdvisory(true);
    setAdvisoryError(null);
    resetAiOutputReviewState();

    const correlationId =
      createTraceId();

    try {
      const response =
        await fetch(
          "/api/capa/" +
            encodeURIComponent(
              createdCapa.capaCaseId,
            ) +
            "/intake-advisory",
          {
            method:
              "POST",

            headers: {
              "content-type":
                "application/json",

              "x-request-id":
                createTraceId(),

              "x-correlation-id":
                correlationId,
            },

            body:
              JSON.stringify(
                advisoryFocus.trim()
                  ? {
                      focus:
                        advisoryFocus,
                    }
                  : {},
              ),
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          apiErrorMessage(
            body,
            "The governed CAPA intake analysis could not be generated.",
          ),
        );
      }

      const parsedAdvisory =
        parsedIntakeAdvisoryResponse(
          body,
        );

      if (parsedAdvisory === null) {
        throw new Error(
          "The server returned an incomplete CAPA intake advisory response.",
        );
      }

      if (
        parsedAdvisory.snapshot
          .capaCaseId !==
          createdCapa.capaCaseId
      ) {
        throw new Error(
          "The server returned an advisory for a different CAPA case.",
        );
      }

      const responseEnvelope =
        isRecord(body)
          ? body
          : null;

      setIntakeAdvisory(
        parsedAdvisory.advisory,
      );

      setAdvisorySnapshot(
        parsedAdvisory.snapshot,
      );

      setAdvisoryCorrelationId(
        responseEnvelope !== null &&
        typeof responseEnvelope.correlation_id ===
          "string"
          ? responseEnvelope.correlation_id
          : correlationId,
      );
    } catch (error) {
      setIntakeAdvisory(null);
      setAdvisorySnapshot(null);

      setAdvisoryCorrelationId(
        null,
      );

      setAdvisoryError(
        error instanceof Error
          ? error.message
          : "The governed CAPA intake analysis could not be generated.",
      );
    } finally {
      setIsRequestingAdvisory(false);
    }
  }

  function createAnother() {
    setFields(EMPTY_FIELDS);
    setErrors({});
    setSubmitError(null);
    setCreatedCapa(null);

    setAdvisoryFocus("");
    setIntakeAdvisory(null);
    setAdvisorySnapshot(null);
    setAdvisoryError(null);
    setAdvisoryCorrelationId(null);

    resetAiOutputReviewState();

    setStep("edit");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-7 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-blue-300">
            Controlled Quality Workflow
          </p>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            LVT CAPA Assistant
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
            Create and review the initiating
            information for a corrective and
            preventive action record.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/chat"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Back to Chat
          </Link>
        </div>
      </header>

      <div className="mb-6 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm leading-6 text-blue-100">
        <span className="font-semibold">
          Organization-scoped workspace:
        </span>{" "}
        Only CAPA records authorized for your
        active organization are shown. Draft
        creation does not approve or advance
        a CAPA.
      </div>

      <section
        aria-labelledby="capa-workspace-heading"
        className="mb-8 rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-2xl backdrop-blur sm:p-7"
      >
        <div className="flex flex-col gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
              Durable records
            </p>

            <h2
              id="capa-workspace-heading"
              className="mt-2 text-xl font-semibold"
            >
              CAPA workspace
            </h2>

            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Review the most recently created
              CAPA records for your organization.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void loadCases("replace")
            }
            disabled={isLoadingCases}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950/70 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:text-zinc-500"
          >
            {isLoadingCases
              ? "Refreshing\u2026"
              : "Refresh cases"}
          </button>
        </div>

        {workflowSubmissionMessage ? (
          <div
            role="status"
            className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-200"
          >
            {workflowSubmissionMessage}
          </div>
        ) : null}

        {caseListError ? (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200"
          >
            <p>{caseListError}</p>

            <button
              type="button"
              onClick={() =>
                void loadCases("replace")
              }
              className="mt-3 font-semibold text-red-100 underline decoration-red-300/50 underline-offset-4 hover:text-white"
            >
              Try loading the workspace again
            </button>
          </div>
        ) : null}

        {openCaseError !== null ? (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200"
          >
            {openCaseError}
          </div>
        ) : null}

        {isLoadingCases &&
        listedCases.length === 0 ? (
          <div
            role="status"
            className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950/50 px-4 py-8 text-center text-sm text-zinc-400"
          >
            Loading CAPA cases{"\u2026"}
          </div>
        ) : null}

        {!isLoadingCases &&
        caseListError === null &&
        listedCases.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/40 px-5 py-8 text-center">
            <h3 className="font-semibold text-zinc-100">
              No CAPA records yet
            </h3>

            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-400">
              Complete the controlled intake
              below to create the first CAPA
              record for this organization.
            </p>
          </div>
        ) : null}

        {listedCases.length > 0 ? (
          <div className="mt-5 space-y-3">
            {listedCases.map(
              (capaCase) => (
                <article
                  key={
                    capaCase.capaCaseId
                  }
                  className="grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-mono text-sm font-semibold text-blue-200">
                        {
                          capaCase.caseNumber
                        }
                      </h3>

                      <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200">
                        {statusName(
                          capaCase.status,
                        )}
                      </span>
                    </div>

                    <dl className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                      <div>
                        <dt className="sr-only">
                          Created
                        </dt>
                        <dd>
                          Created{" "}
                          {formattedDate(
                            capaCase.createdAt,
                          )}
                        </dd>
                      </div>

                      <div>
                        <dt className="sr-only">
                          Last updated
                        </dt>
                        <dd>
                          Updated{" "}
                          {formattedDate(
                            capaCase.updatedAt,
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-col items-start gap-3 sm:items-end">
                    <div className="text-left sm:text-right">
                      <p className="text-xs text-zinc-500">
                        Record version
                      </p>
                      <p className="mt-1 font-mono text-sm text-zinc-300">
                        {capaCase.recordVersion}
                      </p>
                    </div>

                    <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                      <button
                        type="button"
                        disabled={
                          openingCaseId !== null
                        }
                        onClick={() =>
                          void openExistingCase(
                            capaCase,
                          )
                        }
                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-50"
                      >
                        {openingCaseId ===
                        capaCase.capaCaseId
                          ? "Opening..."
                          : "Open case"}
                      </button>

                      {capaCase.status === "S00" ? (
                        <button
                          type="button"
                          disabled={
                            openingCaseId !== null
                          }
                          onClick={() =>
                            beginIntakeSubmission(
                              capaCase,
                            )
                          }
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-blue-400/40 bg-blue-500/15 px-4 py-2 text-sm font-semibold text-blue-100 transition hover:border-blue-300 hover:bg-blue-500/25 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-wait disabled:opacity-50"
                        >
                          Submit Intake
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ),
            )}
          </div>
        ) : null}

        {nextListCursor !== null ? (
          <div className="mt-5 flex justify-center border-t border-zinc-800 pt-5">
            <button
              type="button"
              onClick={() =>
                void loadCases(
                  "append",
                  nextListCursor,
                )
              }
              disabled={
                isLoadingMoreCases
              }
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950/70 px-5 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:text-zinc-500"
            >
              {isLoadingMoreCases
                ? "Loading more\u2026"
                : "Load more cases"}
            </button>
          </div>
        ) : null}
      </section>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          ["1", "Enter intake", "edit"],
          ["2", "Human review", "review"],
          [
            "3",
            createdCapa?.status === "S10"
              ? "Intake submitted"
              : "Draft created",
            "created",
          ],
        ].map(
          ([
            number,
            label,
            itemStep,
          ]) => {
            const steps: WorkflowStep[] = [
              "edit",
              "review",
              "created",
            ];

            const activeIndex =
              steps.indexOf(step);

            const itemIndex =
              steps.indexOf(
                itemStep as WorkflowStep,
              );

            const isCurrent =
              activeIndex === itemIndex &&
              !(step === "created" &&
                itemStep === "created");

            const isComplete =
              activeIndex > itemIndex ||
              (step === "created" &&
                itemStep === "created");

            return (
              <div
                key={itemStep}
                className={`rounded-2xl border px-4 py-3 ${
                  isCurrent
                    ? "border-blue-400/50 bg-blue-500/15"
                    : isComplete
                      ? "border-emerald-400/30 bg-emerald-500/10"
                      : "border-zinc-800 bg-zinc-900/60"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      isCurrent
                        ? "bg-blue-500 text-white"
                        : isComplete
                          ? "bg-emerald-500 text-white"
                          : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {isComplete
                      ? "\u2713"
                      : number}
                  </span>

                  <span className="text-sm font-medium">
                    {label}
                  </span>
                </div>
              </div>
            );
          },
        )}
      </div>

      {submitError ? (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200"
        >
          {submitError}
        </div>
      ) : null}

      {step === "edit" ? (
        <form
          onSubmit={proceedToReview}
          noValidate
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/85 p-5 shadow-2xl backdrop-blur sm:p-7">
            <div className="border-b border-zinc-800 pb-5">
              <h2 className="text-xl font-semibold">
                CAPA intake
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Describe the event that may
                require investigation and
                corrective or preventive
                action.
              </p>
            </div>

            <div className="mt-6 space-y-6">
              <div>
                <div className="flex items-end justify-between gap-4">
                  <label
                    htmlFor="initiating-event"
                    className="text-sm font-medium text-zinc-100"
                  >
                    Initiating event{" "}
                    <span className="text-red-300">
                      *
                    </span>
                  </label>

                  <span
                    className={`text-xs ${
                      charactersRemaining < 0
                        ? "text-red-300"
                        : "text-zinc-500"
                    }`}
                  >
                    {charactersRemaining.toLocaleString()}{" "}
                    remaining
                  </span>
                </div>

                <textarea
                  id="initiating-event"
                  name="initiating_event"
                  rows={9}
                  maxLength={
                    INPUT_LIMITS.initiatingEvent +
                    1
                  }
                  value={
                    fields.initiatingEvent
                  }
                  onChange={(event) =>
                    updateField(
                      "initiatingEvent",
                      event.target.value,
                    )
                  }
                  aria-invalid={
                    errors.initiatingEvent
                      ? true
                      : undefined
                  }
                  aria-describedby={
                    errors.initiatingEvent
                      ? "initiating-event-error"
                      : "initiating-event-help"
                  }
                  placeholder="Describe what occurred, where it occurred, how it was detected, and why it may require CAPA evaluation."
                  className="mt-2 min-h-48 w-full resize-y rounded-2xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
                />

                {errors.initiatingEvent ? (
                  <p
                    id="initiating-event-error"
                    className="mt-2 text-sm text-red-300"
                  >
                    {
                      errors.initiatingEvent
                    }
                  </p>
                ) : (
                  <p
                    id="initiating-event-help"
                    className="mt-2 text-xs leading-5 text-zinc-500"
                  >
                    Do not include passwords,
                    authentication tokens, or
                    unnecessary personal
                    information.
                  </p>
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="source-type"
                    className="text-sm font-medium text-zinc-100"
                  >
                    Source type{" "}
                    <span className="text-red-300">
                      *
                    </span>
                  </label>

                  <input
                    id="source-type"
                    name="source_type"
                    type="text"
                    maxLength={
                      INPUT_LIMITS.sourceType
                    }
                    value={fields.sourceType}
                    onChange={(event) =>
                      updateField(
                        "sourceType",
                        event.target.value,
                      )
                    }
                    aria-invalid={
                      errors.sourceType
                        ? true
                        : undefined
                    }
                    aria-describedby={
                      errors.sourceType
                        ? "source-type-error"
                        : "source-type-help"
                    }
                    placeholder="NONCONFORMANCE"
                    autoCapitalize="characters"
                    className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
                  />

                  {errors.sourceType ? (
                    <p
                      id="source-type-error"
                      className="mt-2 text-sm text-red-300"
                    >
                      {errors.sourceType}
                    </p>
                  ) : (
                    <p
                      id="source-type-help"
                      className="mt-2 text-xs leading-5 text-zinc-500"
                    >
                      Examples:
                      NONCONFORMANCE,
                      COMPLAINT,
                      AUDIT_FINDING.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="source-reference"
                    className="text-sm font-medium text-zinc-100"
                  >
                    Source reference
                  </label>

                  <input
                    id="source-reference"
                    name="source_reference"
                    type="text"
                    maxLength={
                      INPUT_LIMITS.sourceReference
                    }
                    value={
                      fields.sourceReference
                    }
                    onChange={(event) =>
                      updateField(
                        "sourceReference",
                        event.target.value,
                      )
                    }
                    aria-invalid={
                      errors.sourceReference
                        ? true
                        : undefined
                    }
                    placeholder="NCR-2026-0042"
                    className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
                  />

                  {errors.sourceReference ? (
                    <p className="mt-2 text-sm text-red-300">
                      {
                        errors.sourceReference
                      }
                    </p>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Optional source record or
                      document identifier.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="organization-reference"
                  className="text-sm font-medium text-zinc-100"
                >
                  Organization reference
                </label>

                <input
                  id="organization-reference"
                  name="organization_reference"
                  type="text"
                  maxLength={
                    INPUT_LIMITS.organizationReference
                  }
                  value={
                    fields.organizationReference
                  }
                  onChange={(event) =>
                    updateField(
                      "organizationReference",
                      event.target.value,
                    )
                  }
                  aria-invalid={
                    errors.organizationReference
                      ? true
                      : undefined
                  }
                  placeholder="CAPA-LOCAL-19"
                  className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
                />

                {errors.organizationReference ? (
                  <p className="mt-2 text-sm text-red-300">
                    {
                      errors.organizationReference
                    }
                  </p>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    Optional internal reference
                    used by your organization.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-zinc-800 pt-6 sm:flex-row sm:justify-end">
              <Link
                href="/chat"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Cancel
              </Link>

              <button
                type="submit"
                disabled={!canReview}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                Review CAPA draft
              </button>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900/75 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Human review
              </h2>

              <p className="mt-3 text-sm leading-6 text-zinc-400">
                You will review the entered
                information before the draft
                is created. The assistant
                does not approve or advance
                the CAPA.
              </p>
            </section>

            <section className="rounded-3xl border border-zinc-800 bg-zinc-900/75 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Signed-in user
              </h2>

              <p className="mt-3 break-all text-sm text-zinc-400">
                {userEmail ||
                  "Authenticated user"}
              </p>
            </section>

            <section className="rounded-3xl border border-blue-400/20 bg-blue-500/10 p-5">
              <h2 className="text-sm font-semibold text-blue-200">
                Initial workflow state
              </h2>

              <p className="mt-2 text-lg font-semibold">
                {"S00 \u2014 Draft Intake"}
              </p>

              <p className="mt-2 text-sm leading-6 text-blue-100/75">
                This is a working state and
                is not an approval or final
                CAPA determination.
              </p>
            </section>
          </aside>
        </form>
      ) : null}

      {step === "review" ? (
        <section className="mx-auto max-w-4xl rounded-3xl border border-zinc-800 bg-zinc-900/85 p-5 shadow-2xl sm:p-8">
          <div className="border-b border-zinc-800 pb-6">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-blue-300">
              Human confirmation required
            </p>

            <h2 className="mt-2 text-2xl font-semibold">
              Review the CAPA draft
            </h2>

            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Confirm that this information
              accurately represents the
              initiating event. Submission
              creates an auditable S00 draft.
            </p>
          </div>

          <dl className="mt-6 divide-y divide-zinc-800 rounded-2xl border border-zinc-800">
            <ReviewItem
              label="Initiating event"
              value={
                fields.initiatingEvent
              }
              preserveWhitespace
            />

            <ReviewItem
              label="Source type"
              value={fields.sourceType}
            />

            <ReviewItem
              label="Source reference"
              value={
                fields.sourceReference ||
                "Not provided"
              }
            />

            <ReviewItem
              label="Organization reference"
              value={
                fields.organizationReference ||
                "Not provided"
              }
            />

            <ReviewItem
              label="Initial state"
              value={
                "S00 \u2014 Draft Intake"
              }
            />
          </dl>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-700 bg-zinc-950/60 p-4">
            <input
              required
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-500"
              onChange={(event) => {
                const checked =
                  event.target.checked;

                event.currentTarget.dataset.checked =
                  String(checked);
              }}
              id="human-confirmation"
            />

            <span>
              <span className="block text-sm font-medium text-zinc-100">
                I reviewed this information.
              </span>

              <span className="mt-1 block text-xs leading-5 text-zinc-500">
                I understand this action
                creates a controlled draft
                record and audit event.
              </span>
            </span>
          </label>

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() =>
                setStep("edit")
              }
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              Return to edit
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                const confirmation =
                  document.getElementById(
                    "human-confirmation",
                  ) as
                    | HTMLInputElement
                    | null;

                if (
                  !confirmation?.checked
                ) {
                  setSubmitError(
                    "Confirm that you reviewed the CAPA information before creating the draft.",
                  );
                  return;
                }

                void submitCapa();
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-wait disabled:bg-blue-800"
            >
              {isSubmitting
                ? "Creating controlled draft..."
                : "Confirm and create draft"}
            </button>
          </div>
        </section>
      ) : null}

      {step === "created" &&
      createdCapa ? (
        <section className="mx-auto max-w-4xl space-y-6">
          <div className="rounded-3xl border border-emerald-400/25 bg-emerald-500/10 p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-300">
                  {createdCapa.status === "S10"
                    ? "CAPA intake submitted"
                    : "CAPA draft created"}
                </p>

                <h2 className="mt-2 text-3xl font-semibold">
                  {
                    createdCapa.caseNumber
                  }
                </h2>

                <p className="mt-3 text-sm text-emerald-100/80">
                  {createdCapa.status === "S10"
                    ? "The submitted version and its audit event were committed atomically."
                    : "The draft record and its audit event were committed atomically."}
                </p>
              </div>

              <span className="inline-flex w-fit rounded-full border border-blue-300/30 bg-blue-500/15 px-4 py-2 text-sm font-semibold text-blue-200">
                {createdCapa.status}
                {" \u2014 "}
                {statusName(
                  createdCapa.status,
                )}
              </span>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900/85 p-5 sm:p-7">
              <h3 className="text-lg font-semibold">
                Controlled intake record
              </h3>

              <dl className="mt-5 divide-y divide-zinc-800 rounded-2xl border border-zinc-800">
                <ReviewItem
                  label="Initiating event"
                  value={
                    createdCapa.initiatingEvent
                  }
                  preserveWhitespace
                />

                <ReviewItem
                  label="Source type"
                  value={
                    createdCapa.sourceType
                  }
                />

                <ReviewItem
                  label="Source reference"
                  value={
                    createdCapa.sourceReference ||
                    "Not provided"
                  }
                />

                <ReviewItem
                  label="Organization reference"
                  value={
                    createdCapa.organizationReference ||
                    "Not provided"
                  }
                />

                <ReviewItem
                  label="Created"
                  value={formattedDate(
                    createdCapa.createdAt,
                  )}
                />
              </dl>
            </section>

            <aside className="space-y-5">
              <section className="rounded-3xl border border-zinc-800 bg-zinc-900/75 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Verification
                </h3>

                <p
                  className={`mt-3 text-sm leading-6 ${
                    createdCapa.retrievalVerified
                      ? "text-emerald-300"
                      : "text-amber-300"
                  }`}
                >
                  {createdCapa.retrievalVerified
                    ? "\u2713 Controlled record was retrieved and verified."
                    : "The record was created, but retrieval verification was unavailable."}
                </p>
              </section>

              <section className="rounded-3xl border border-zinc-800 bg-zinc-900/75 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Record details
                </h3>

                <dl className="mt-3 space-y-3 text-xs">
                  <IdentifierItem
                    label="Record version"
                    value={String(
                      createdCapa.recordVersion,
                    )}
                  />

                  <IdentifierItem
                    label="CAPA case ID"
                    value={
                      createdCapa.capaCaseId
                    }
                  />

                  <IdentifierItem
                    label="Correlation ID"
                    value={
                      createdCapa.correlationId
                    }
                  />
                </dl>
              </section>
            </aside>
          </div>

          {createdCapa.status === "S10" ? (
            <section
              aria-labelledby="ai-intake-analysis-heading"
              className="rounded-3xl border border-violet-400/25 bg-violet-500/10 p-5 sm:p-7"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
                    Governed AI assistance
                  </p>

                  <h3
                    id="ai-intake-analysis-heading"
                    className="mt-2 text-xl font-semibold text-white"
                  >
                    AI Intake Analysis
                  </h3>

                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                    Generate an advisory-only analysis of the submitted intake.
                    The AI cannot approve the CAPA, change workflow state, or
                    overwrite the controlled record.
                  </p>
                </div>

                <span className="inline-flex w-fit rounded-full border border-amber-300/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
                  Human review required
                </span>
              </div>

              <label className="mt-5 block">
                <span className="text-sm font-medium text-zinc-200">
                  Optional analysis focus
                </span>

                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  You may ask the governed agent to emphasize a specific issue.
                  This does not change its authorization, model, evidence, or
                  workflow controls.
                </span>

                <textarea
                  value={advisoryFocus}
                  onChange={(event) =>
                    setAdvisoryFocus(
                      event.target.value,
                    )
                  }
                  maxLength={1_000}
                  rows={3}
                  disabled={
                    isRequestingAdvisory ||
                    isSubmittingReview
                  }
                  placeholder="Example: Focus on containment risk and missing investigation information."
                  className="mt-3 w-full rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30 disabled:cursor-wait disabled:opacity-60"
                />
              </label>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={
                    isRequestingAdvisory ||
                    isSubmittingReview
                  }
                  onClick={() =>
                    void requestIntakeAdvisory()
                  }
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:cursor-wait disabled:bg-violet-900 disabled:text-violet-300"
                >
                  {isRequestingAdvisory
                    ? "Generating governed analysis..."
                    : intakeAdvisory === null
                      ? "Generate AI Intake Analysis"
                      : "Regenerate AI Intake Analysis"}
                </button>

                <p className="text-xs text-zinc-500">
                  Advisory output is stored separately from the human CAPA
                  record.
                </p>
              </div>

              {advisoryError !== null ? (
                <div
                  role="alert"
                  className="mt-5 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm leading-6 text-red-200"
                >
                  {advisoryError}
                </div>
              ) : null}

              {intakeAdvisory !== null ? (
                <div className="mt-6 space-y-5">
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
                    <p className="text-sm font-semibold text-amber-200">
                      Advisory only — human acceptance required
                    </p>

                    <p className="mt-1 text-xs leading-5 text-amber-100/75">
                      This output has not changed the CAPA workflow or controlled
                      intake record.
                    </p>
                  </div>

                  {intakeAdvisory.proposal !== null ? (
                    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-5">
                      <h4 className="font-semibold text-zinc-100">
                        Proposed problem statement
                      </h4>

                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                        {
                          intakeAdvisory.proposal
                            .problem_statement_draft
                        }
                      </p>
                    </section>
                  ) : null}

                  {intakeAdvisory.proposal !== null ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <AdvisoryList
                        title="Scope dimensions"
                        items={
                          intakeAdvisory.proposal
                            .scope_dimensions
                        }
                      />

                      <AdvisoryList
                        title="Missing dimensions"
                        items={
                          intakeAdvisory.proposal
                            .missing_dimensions
                        }
                      />

                      <AdvisoryList
                        title="Containment-risk questions"
                        items={
                          intakeAdvisory.proposal
                            .containment_risk_questions
                        }
                      />

                      <AdvisoryList
                        title="Investigation questions"
                        items={
                          intakeAdvisory.proposal
                            .investigation_questions
                        }
                      />
                    </div>
                  ) : null}

                  <div className="grid gap-4 lg:grid-cols-2">
                    <AdvisoryList
                      title="Missing information"
                      items={
                        intakeAdvisory
                          .missing_information
                      }
                    />

                    <AdvisoryList
                      title="Assumptions"
                      items={
                        intakeAdvisory
                          .assumptions
                      }
                    />

                    <AdvisoryList
                      title="Conflicts and alternatives"
                      items={
                        intakeAdvisory
                          .conflicts_and_alternatives
                      }
                    />

                    <AdvisoryList
                      title="Uncertainty and limitations"
                      items={
                        intakeAdvisory
                          .uncertainty_and_limitations
                      }
                    />

                    <AdvisoryList
                      title="Human action required"
                      items={
                        intakeAdvisory
                          .human_action_required
                      }
                    />

                    <AdvisoryList
                      title="Warnings"
                      items={
                        intakeAdvisory
                          .warnings
                      }
                    />
                  </div>

                  <section className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-5">
                    <h4 className="font-semibold text-zinc-100">
                      Supporting citations
                    </h4>

                    {intakeAdvisory.citations.length === 0 ? (
                      <p className="mt-3 text-sm text-zinc-500">
                        No supporting citations were returned.
                      </p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {intakeAdvisory.citations.map(
                          (citation) => (
                            <article
                              key={
                                citation.citation_id
                              }
                              className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4"
                            >
                              <p className="text-sm font-medium text-blue-200">
                                {
                                  citation.rendered_label
                                }
                              </p>

                              <p className="mt-1 text-sm text-zinc-300">
                                {
                                  citation.source_title
                                }
                              </p>

                              <p className="mt-2 text-xs leading-5 text-zinc-500">
                                {
                                  citation.precise_locator
                                }
                              </p>

                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                                <span>
                                  {
                                    citation.relationship
                                  }
                                </span>

                                <span aria-hidden="true">
                                  •
                                </span>

                                <span>
                                  {
                                    citation.validation_status
                                  }
                                </span>
                              </div>
                            </article>
                          ),
                        )}
                      </div>
                    )}
                  </section>

                  <section
                    aria-labelledby="ai-output-human-review-heading"
                    className="rounded-2xl border border-zinc-700 bg-zinc-950/70 p-5"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
                      Human review required
                    </p>

                    <h4
                      id="ai-output-human-review-heading"
                      className="mt-2 text-lg font-semibold text-zinc-100"
                    >
                      Review the governed AI advisory
                    </h4>

                    <p className="mt-3 text-sm leading-6 text-zinc-400">
                      This content was generated by AI and remains advisory.
                      Your disposition is a human-authored review decision.
                      Accepting it does not approve the CAPA, change workflow,
                      or modify the controlled CAPA record.
                    </p>

                    {reviewResult === null ? (
                      <>
                        <fieldset
                          className="mt-5"
                          disabled={
                            isSubmittingReview ||
                            reviewFailureBlocksRetry(
                              reviewFailure,
                            )
                          }
                        >
                          <legend className="text-sm font-medium text-zinc-200">
                            Human disposition
                          </legend>

                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            No disposition is preselected. Choose one action
                            deliberately.
                          </p>

                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <button
                              type="button"
                              aria-pressed={
                                reviewDecision ===
                                "accept"
                              }
                              onClick={() =>
                                selectAiOutputReviewDecision(
                                  "accept",
                                )
                              }
                              className={
                                "min-h-12 rounded-xl border px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 " +
                                (
                                  reviewDecision ===
                                  "accept"
                                    ? "border-blue-400 bg-blue-500/10 text-blue-100"
                                    : "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600"
                                )
                              }
                            >
                              <span className="block font-semibold">
                                Accept
                              </span>

                              <span className="mt-1 block text-xs leading-5 text-zinc-500">
                                Acceptable for this review purpose only.
                              </span>
                            </button>

                            <button
                              type="button"
                              aria-pressed={
                                reviewDecision ===
                                "reject"
                              }
                              onClick={() =>
                                selectAiOutputReviewDecision(
                                  "reject",
                                )
                              }
                              className={
                                "min-h-12 rounded-xl border px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 " +
                                (
                                  reviewDecision ===
                                  "reject"
                                    ? "border-blue-400 bg-blue-500/10 text-blue-100"
                                    : "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600"
                                )
                              }
                            >
                              <span className="block font-semibold">
                                Reject
                              </span>

                              <span className="mt-1 block text-xs leading-5 text-zinc-500">
                                Reject the AI proposal and document why.
                              </span>
                            </button>

                            <button
                              type="button"
                              aria-pressed={
                                reviewDecision ===
                                "revise"
                              }
                              onClick={() =>
                                selectAiOutputReviewDecision(
                                  "revise",
                                )
                              }
                              className={
                                "min-h-12 rounded-xl border px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 " +
                                (
                                  reviewDecision ===
                                  "revise"
                                    ? "border-blue-400 bg-blue-500/10 text-blue-100"
                                    : "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600"
                                )
                              }
                            >
                              <span className="block font-semibold">
                                Revise
                              </span>

                              <span className="mt-1 block text-xs leading-5 text-zinc-500">
                                Author a human replacement while preserving
                                the original AI output.
                              </span>
                            </button>
                          </div>
                        </fieldset>

                        {reviewDecision !== null ? (
                          <div className="mt-5">
                            <label
                              htmlFor="ai-review-rationale"
                              className="text-sm font-medium text-zinc-200"
                            >
                              Review rationale
                              {
                                reviewDecision ===
                                  "accept"
                                  ? " (optional)"
                                  : " (required)"
                              }
                            </label>

                            <textarea
                              id="ai-review-rationale"
                              value={
                                reviewRationale
                              }
                              maxLength={4000}
                              rows={4}
                              disabled={
                                isSubmittingReview ||
                                reviewFailureBlocksRetry(
                                  reviewFailure,
                                )
                              }
                              onChange={(event) =>
                                updateReviewRationale(
                                  event.target.value,
                                )
                              }
                              className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder={
                                reviewDecision ===
                                "accept"
                                  ? "Optional: document why the advisory is acceptable for this review purpose."
                                  : "Document the human review rationale."
                              }
                            />

                            <p className="mt-1 text-right text-xs text-zinc-600">
                              {
                                reviewRationale.length
                              }
                              /4000
                            </p>
                          </div>
                        ) : null}

                        {reviewDecision ===
                        "revise" ? (
                          <div className="mt-6 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                            <div>
                              <h5 className="text-sm font-semibold text-zinc-200">
                                Human-authored replacement
                              </h5>

                              <p className="mt-1 text-xs leading-5 text-zinc-500">
                                These fields start blank intentionally. The AI
                                proposal is not copied into the controlled
                                human revision.
                              </p>
                            </div>

                            <div>
                              <label
                                htmlFor="ai-review-problem-statement"
                                className="text-sm font-medium text-zinc-300"
                              >
                                Problem statement
                              </label>

                              <textarea
                                id="ai-review-problem-statement"
                                rows={5}
                                maxLength={8000}
                                value={
                                  reviewRevisionEditor
                                    .problemStatement
                                }
                                disabled={
                                  isSubmittingReview
                                }
                                onChange={(event) =>
                                  updateReviewRevisionField(
                                    "problemStatement",
                                    event.target.value,
                                  )
                                }
                                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              />
                            </div>

                            {[
                              {
                                id:
                                  "ai-review-scope-dimensions",
                                label:
                                  "Scope dimensions",
                                field:
                                  "scopeDimensions",
                                value:
                                  reviewRevisionEditor
                                    .scopeDimensions,
                              },
                              {
                                id:
                                  "ai-review-missing-dimensions",
                                label:
                                  "Missing dimensions",
                                field:
                                  "missingDimensions",
                                value:
                                  reviewRevisionEditor
                                    .missingDimensions,
                              },
                              {
                                id:
                                  "ai-review-containment-questions",
                                label:
                                  "Containment / risk questions",
                                field:
                                  "containmentRiskQuestions",
                                value:
                                  reviewRevisionEditor
                                    .containmentRiskQuestions,
                              },
                              {
                                id:
                                  "ai-review-investigation-questions",
                                label:
                                  "Investigation questions",
                                field:
                                  "investigationQuestions",
                                value:
                                  reviewRevisionEditor
                                    .investigationQuestions,
                              },
                            ].map(
                              (item) => (
                                <div
                                  key={
                                    item.id
                                  }
                                >
                                  <label
                                    htmlFor={
                                      item.id
                                    }
                                    className="text-sm font-medium text-zinc-300"
                                  >
                                    {
                                      item.label
                                    }
                                  </label>

                                  <textarea
                                    id={
                                      item.id
                                    }
                                    rows={4}
                                    value={
                                      item.value
                                    }
                                    disabled={
                                      isSubmittingReview
                                    }
                                    onChange={(event) =>
                                      updateReviewRevisionField(
                                        item.field as
                                          keyof CapaAiOutputReviewRevisionEditor,
                                        event.target.value,
                                      )
                                    }
                                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                    placeholder="One item per line."
                                  />
                                </div>
                              ),
                            )}
                          </div>
                        ) : null}

                        {reviewFailure !== null ? (
                          <div
                            role="alert"
                            className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
                          >
                            <p className="text-sm font-semibold text-amber-100">
                              Human review not recorded
                            </p>

                            <p className="mt-2 text-sm leading-6 text-amber-100/80">
                              {
                                reviewFailure.message
                              }
                            </p>

                            <p className="mt-2 text-xs leading-5 text-amber-200/70">
                              {
                                reviewFailureGuidance(
                                  reviewFailure,
                                )
                              }
                            </p>

                            {reviewFailure.correlationId !==
                            null ? (
                              <p className="mt-2 break-all font-mono text-[11px] text-amber-200/60">
                                Correlation ID:{" "}
                                {
                                  reviewFailure
                                    .correlationId
                                }
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="mt-5 flex justify-end">
                          <button
                            type="button"
                            onClick={
                              beginAiOutputReviewConfirmation
                            }
                            disabled={
                              reviewDecision === null ||
                              isSubmittingReview ||
                              reviewFailureBlocksRetry(
                                reviewFailure,
                              )
                            }
                            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-blue-500/60 bg-blue-500/10 px-5 py-2.5 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {
                              isSubmittingReview
                                ? "Recording review..."
                                : "Review and record..."
                            }
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="mt-5 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                        <p className="text-sm font-semibold text-blue-100">
                          Human review recorded
                        </p>

                        <p className="mt-2 text-sm leading-6 text-blue-100/80">
                          The immutable human disposition was recorded.
                          This action did not approve the CAPA, modify the
                          controlled record, or transition workflow.
                        </p>

                        {reviewResult.replayed ? (
                          <p className="mt-2 text-xs leading-5 text-blue-200/70">
                            The server recognized an exact idempotent replay;
                            no duplicate review was created.
                          </p>
                        ) : null}

                        <dl className="mt-4 grid gap-3 text-xs text-zinc-400 sm:grid-cols-2">
                          <div>
                            <dt className="text-zinc-600">
                              Disposition
                            </dt>

                            <dd className="mt-1 font-medium text-zinc-300">
                              {
                                reviewResult.decision
                              }
                            </dd>
                          </div>

                          <div>
                            <dt className="text-zinc-600">
                              Reviewed at
                            </dt>

                            <dd className="mt-1 font-mono text-zinc-300">
                              {
                                reviewResult.reviewedAt
                              }
                            </dd>
                          </div>

                          <div>
                            <dt className="text-zinc-600">
                              Review ID
                            </dt>

                            <dd className="mt-1 break-all font-mono text-zinc-300">
                              {
                                reviewResult.reviewId
                              }
                            </dd>
                          </div>

                          <div>
                            <dt className="text-zinc-600">
                              Audit event ID
                            </dt>

                            <dd className="mt-1 break-all font-mono text-zinc-300">
                              {
                                reviewResult.auditEventId
                              }
                            </dd>
                          </div>

                          <div className="sm:col-span-2">
                            <dt className="text-zinc-600">
                              Correlation ID
                            </dt>

                            <dd className="mt-1 break-all font-mono text-zinc-300">
                              {
                                reviewResult.correlationId
                              }
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}
                  </section>

                  <div className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4 text-xs text-zinc-500 sm:grid-cols-2">
                    <div>
                      <span className="block text-zinc-600">
                        AI run ID
                      </span>

                      <span className="mt-1 block break-all font-mono text-zinc-400">
                        {intakeAdvisory.run_id}
                      </span>
                    </div>

                    <div>
                      <span className="block text-zinc-600">
                        Correlation ID
                      </span>

                      <span className="mt-1 block break-all font-mono text-zinc-400">
                        {
                          advisoryCorrelationId ??
                          "Unavailable"
                        }
                      </span>
                    </div>

                    <div>
                      <span className="block text-zinc-600">
                        AI output ID
                      </span>

                      <span className="mt-1 block break-all font-mono text-zinc-400">
                        {
                          intakeAdvisory.output_id
                        }
                      </span>
                    </div>

                    <div>
                      <span className="block text-zinc-600">
                        CAPA case version
                      </span>

                      <span className="mt-1 block break-all font-mono text-zinc-400">
                        {
                          advisorySnapshot
                            ?.caseVersionId ??
                          "Unavailable"
                        }
                      </span>
                    </div>

                    <div>
                      <span className="block text-zinc-600">
                        CAPA record version
                      </span>

                      <span className="mt-1 block font-mono text-zinc-400">
                        {
                          advisorySnapshot
                            ?.recordVersion ??
                          "Unavailable"
                        }
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link
              href="/chat"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Back to Chat
            </Link>

            <button
              type="button"
              onClick={createAnother}
              disabled={isSubmittingReview}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create another CAPA
            </button>

            {createdCapa.status === "S00" ? (
              <button
                type="button"
                onClick={() =>
                  beginIntakeSubmission({
                    capaCaseId:
                      createdCapa.capaCaseId,
                    caseNumber:
                      createdCapa.caseNumber,
                    recordVersion:
                      createdCapa.recordVersion,
                    currentVersionId:
                      createdCapa.currentVersionId,
                  })
                }
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                Submit Intake
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {reviewConfirmationOpen &&
      reviewDecision !== null &&
      intakeAdvisory !== null &&
      advisorySnapshot !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget
            ) {
              cancelAiOutputReviewConfirmation();
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-ai-review-heading"
            className="w-full max-w-xl rounded-3xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl sm:p-7"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
              Immutable human review
            </p>

            <h2
              id="confirm-ai-review-heading"
              className="mt-2 text-2xl font-semibold"
            >
              Record {reviewDecision} disposition?
            </h2>

            <p className="mt-3 text-sm leading-6 text-zinc-400">
              This will append an immutable, audit-linked human
              review to the governed AI output. It will not approve
              the CAPA, alter the controlled CAPA record, or
              transition workflow.
            </p>

            <dl className="mt-5 grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">
                  Human disposition
                </dt>

                <dd className="mt-1 font-medium capitalize text-zinc-100">
                  {reviewDecision}
                </dd>
              </div>

              <div>
                <dt className="text-zinc-500">
                  CAPA record version
                </dt>

                <dd className="mt-1 font-mono text-zinc-100">
                  {advisorySnapshot.recordVersion}
                </dd>
              </div>

              <div className="sm:col-span-2">
                <dt className="text-zinc-500">
                  AI output ID
                </dt>

                <dd className="mt-1 break-all font-mono text-xs text-zinc-100">
                  {intakeAdvisory.output_id}
                </dd>
              </div>

              <div className="sm:col-span-2">
                <dt className="text-zinc-500">
                  CAPA case version
                </dt>

                <dd className="mt-1 break-all font-mono text-xs text-zinc-100">
                  {advisorySnapshot.caseVersionId}
                </dd>
              </div>
            </dl>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4">
              <input
                type="checkbox"
                checked={
                  reviewConfirmationConfirmed
                }
                disabled={isSubmittingReview}
                onChange={(event) =>
                  setReviewConfirmationConfirmed(
                    event.target.checked,
                  )
                }
                className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-500"
              />

              <span>
                <span className="block text-sm font-medium text-zinc-100">
                  I reviewed this governed AI output and confirm
                  this is my human-authored disposition.
                </span>

                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  I understand this records a review only and does
                  not constitute CAPA approval.
                </span>
              </span>
            </label>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isSubmittingReview}
                onClick={
                  cancelAiOutputReviewConfirmation
                }
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  isSubmittingReview ||
                  !reviewConfirmationConfirmed
                }
                onClick={() =>
                  void submitAiOutputReview()
                }
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                {
                  isSubmittingReview
                    ? "Recording review..."
                    : "Confirm and record review"
                }
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {workflowSubmission !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              cancelIntakeSubmission();
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-intake-heading"
            className="w-full max-w-xl rounded-3xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl sm:p-7"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
              Human review required
            </p>

            <h2
              id="submit-intake-heading"
              className="mt-2 text-2xl font-semibold"
            >
              Submit {workflowSubmission.caseNumber} intake?
            </h2>

            <p className="mt-3 text-sm leading-6 text-zinc-400">
              This controlled workflow action advances the CAPA from S00 — Draft Intake to S10 — Intake Submitted. It creates a new immutable case version and an audit event.
            </p>

            <dl className="mt-5 grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Current state</dt>
                <dd className="mt-1 font-medium text-zinc-100">S00 — Draft Intake</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Record version</dt>
                <dd className="mt-1 font-mono text-zinc-100">{workflowSubmission.recordVersion}</dd>
              </div>
            </dl>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4">
              <input
                type="checkbox"
                checked={workflowSubmissionConfirmed}
                disabled={isSubmittingIntake}
                onChange={(event) =>
                  setWorkflowSubmissionConfirmed(
                    event.target.checked,
                  )
                }
                className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-100">
                  I reviewed the controlled intake record.
                </span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  I confirm it is ready to advance to Intake Submitted.
                </span>
              </span>
            </label>

            {workflowSubmissionError ? (
              <div
                role="alert"
                className="mt-5 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200"
              >
                {workflowSubmissionError}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={isSubmittingIntake}
                onClick={cancelIntakeSubmission}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  isSubmittingIntake ||
                  !workflowSubmissionConfirmed
                }
                onClick={() => void submitIntake()}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                {isSubmittingIntake
                  ? "Submitting intake…"
                  : "Confirm and submit intake"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

interface ReviewItemProps {
  readonly label: string;
  readonly value: string;
  readonly preserveWhitespace?: boolean;
}

function ReviewItem({
  label,
  value,
  preserveWhitespace = false,
}: ReviewItemProps) {
  return (
    <div className="grid gap-2 px-4 py-4 sm:grid-cols-[180px_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-zinc-400">
        {label}
      </dt>

      <dd
        className={`break-words text-sm leading-6 text-zinc-100 ${
          preserveWhitespace
            ? "whitespace-pre-wrap"
            : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

interface IdentifierItemProps {
  readonly label: string;
  readonly value: string;
}

function IdentifierItem({
  label,
  value,
}: IdentifierItemProps) {
  return (
    <div>
      <dt className="text-zinc-500">
        {label}
      </dt>

      <dd className="mt-1 break-all font-mono text-zinc-300">
        {value}
      </dd>
    </div>
  );
}
interface AdvisoryListProps {
  readonly title: string;
  readonly items: readonly string[];
}

function AdvisoryList({
  title,
  items,
}: AdvisoryListProps) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-5">
      <h4 className="font-semibold text-zinc-100">
        {title}
      </h4>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          None identified.
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
          {items.map(
            (
              item,
              index,
            ) => (
              <li
                key={`${title}-${index}`}
                className="flex gap-3"
              >
                <span
                  aria-hidden="true"
                  className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300"
                />

                <span>
                  {item}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
