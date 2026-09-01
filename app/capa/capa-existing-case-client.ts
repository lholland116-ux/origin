import {
  CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
  validateCapaInvestigationPlan,
  type CapaInvestigationPlanContent,
} from "../../lib/capa/domain/capa-investigation-plan";
import {
  CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
  CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE,
  validateCapaEvidenceAssumptionLedger,
  type CapaEvidenceAssumptionLedgerContent,
} from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import {
  CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
  validateCapaRootCausePackage,
  type CapaRootCausePackageContent,
} from "../../lib/capa/domain/capa-root-cause-package";

export interface CapaExistingCaseSummary {
  readonly capaCaseId: string;
  readonly caseNumber: string;
  readonly status: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly sectionVersionId: string;
  readonly createdAt: string;
  readonly initiatingEvent: string;
  readonly sourceType: string;
  readonly sourceReference?: string;
  readonly organizationReference?: string;
  readonly correlationId: string;
  readonly retrievalVerified: boolean;
  readonly investigationPlan?: CapaInvestigationPlanContent;
  readonly investigationPlanSectionVersionId?: string;
  readonly evidenceAssumptionLedger?: CapaEvidenceAssumptionLedgerContent;
  readonly evidenceAssumptionLedgerSectionVersionId?: string;
  readonly rootCausePackage?: CapaRootCausePackageContent;
  readonly rootCausePackageSectionVersionId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function controlledSection(
  sections: readonly unknown[],
  sectionType: string,
  schemaVersion: string,
): Readonly<Record<string, unknown>> | null | false {
  const matches = sections.filter(
    (section) => isRecord(section) && section.section_type === sectionType,
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) return false;
  const section = matches[0];
  if (
    !isRecord(section) ||
    section.schema_version !== schemaVersion ||
    typeof section.section_version_id !== "string" ||
    !UUID.test(section.section_version_id)
  ) return false;
  return section;
}

export interface ParseCapaExistingCaseOptions {
  readonly expectedCaseId: string;
  readonly fallbackCorrelationId: string;
}

function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Parses the authoritative tenant-scoped CAPA GET response used when a
 * human explicitly opens an existing CAPA from the workspace.
 *
 * Browser list-row data is never sufficient to construct the controlled
 * case view. The full server representation must match the selected case
 * and contain a valid current intake section.
 */
export function parseCapaExistingCaseResponse(
  value: unknown,
  options: ParseCapaExistingCaseOptions,
): CapaExistingCaseSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const capa = value.capa;

  if (!isRecord(capa)) {
    return null;
  }

  if (
    capa.capa_case_id !==
      options.expectedCaseId ||
    typeof capa.case_number !== "string" ||
    typeof capa.status !== "string" ||
    typeof capa.record_version !== "number" ||
    !Number.isInteger(
      capa.record_version,
    ) ||
    capa.record_version < 1 ||
    typeof capa.current_version_id !==
      "string" ||
    typeof capa.created_at !== "string" ||
    !Array.isArray(capa.sections)
  ) {
    return null;
  }

  const intakeSection =
    capa.sections.find(
      (candidate) => {
        if (!isRecord(candidate)) {
          return false;
        }

        const content =
          candidate.content;

        return (
          typeof candidate
            .section_version_id ===
            "string" &&
          isRecord(content) &&
          typeof content
            .initiating_event ===
            "string"
        );
      },
    );

  if (!isRecord(intakeSection)) {
    return null;
  }

  const sectionVersionId =
    intakeSection.section_version_id;

  if (
    typeof sectionVersionId !==
      "string"
  ) {
    return null;
  }

  const content =
    intakeSection.content;

  if (!isRecord(content)) {
    return null;
  }

  const initiatingEvent =
    content.initiating_event;

  if (
    typeof initiatingEvent !==
      "string"
  ) {
    return null;
  }

  const source =
    content.source;

  if (
    !isRecord(source) ||
    typeof source.source_type !==
      "string"
  ) {
    return null;
  }

  const sourceReference =
    source.source_reference;

  if (
    sourceReference !== undefined &&
    typeof sourceReference !== "string"
  ) {
    return null;
  }

  const organizationReference =
    content.organization_reference;

  if (
    organizationReference !==
      undefined &&
    typeof organizationReference !==
      "string"
  ) {
    return null;
  }

  const correlationId =
    typeof value.correlation_id ===
      "string"
      ? value.correlation_id
      : options.fallbackCorrelationId;

  const planSection = controlledSection(
    capa.sections,
    CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
    CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  );
  const ledgerSection = controlledSection(
    capa.sections,
    CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE,
    CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
  );
  const packageSection = controlledSection(
    capa.sections,
    CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
    CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
  );
  if (planSection === false || ledgerSection === false || packageSection === false) return null;

  const plan = planSection === null
    ? null
    : validateCapaInvestigationPlan(planSection.content);
  const ledger = ledgerSection === null
    ? null
    : validateCapaEvidenceAssumptionLedger(ledgerSection.content);
  if (
    (plan !== null && plan.status === "invalid") ||
    (ledger !== null && ledger.status === "invalid")
  ) return null;
  const rootPackage = packageSection === null || ledger === null || ledger.status !== "valid"
    ? null
    : validateCapaRootCausePackage(packageSection.content, ledger.value);
  if (packageSection !== null && (rootPackage === null || rootPackage.status === "invalid")) return null;
  if (capa.status === "S40" && (plan === null || plan.status !== "valid")) return null;
  if (
    capa.status === "S50" &&
    (plan === null || plan.status !== "valid" ||
      ledger === null || ledger.status !== "valid" ||
      rootPackage === null || rootPackage.status !== "valid")
  ) return null;

  return Object.freeze({
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
    sectionVersionId,
    createdAt:
      capa.created_at,
    initiatingEvent,
    sourceType:
      source.source_type,
    ...(sourceReference === undefined
      ? {}
      : {
          sourceReference,
        }),
    ...(organizationReference ===
    undefined
      ? {}
      : {
          organizationReference,
        }),
    correlationId,
    retrievalVerified: true,
    ...(planSection !== null && plan !== null && plan.status === "valid" ? {
      investigationPlan: plan.value,
      investigationPlanSectionVersionId: planSection.section_version_id as string,
    } : {}),
    ...(ledgerSection !== null && ledger !== null && ledger.status === "valid" ? {
      evidenceAssumptionLedger: ledger.value,
      evidenceAssumptionLedgerSectionVersionId: ledgerSection.section_version_id as string,
    } : {}),
    ...(packageSection !== null && rootPackage !== null && rootPackage.status === "valid" ? {
      rootCausePackage: rootPackage.value,
      rootCausePackageSectionVersionId: packageSection.section_version_id as string,
    } : {}),
  });
}
