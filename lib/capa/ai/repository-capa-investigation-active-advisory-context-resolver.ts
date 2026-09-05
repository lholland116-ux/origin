import type {
  CapaRepository,
} from "../../database/repositories/capa-repository";
import type {
  AuthenticationContext,
} from "../../security/auth-context";
import {
  getActiveRoleAssignments,
  type TenantContext,
} from "../../security/tenant-context";
import {
  validateCapaEvidenceAssumptionLedger,
  type CapaEvidenceAssumptionLedgerContent,
} from "../domain/capa-evidence-assumption-ledger";
import {
  CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
  validateCapaInvestigationPlan,
} from "../domain/capa-investigation-plan";
import {
  validateCapaRootCausePackage,
  type CapaRootCausePackageContent,
} from "../domain/capa-root-cause-package";
import type {
  CapaSectionVersion,
} from "../domain/capa-types";
import type {
  CapaInvestigationActiveAdvisoryReferenceKey,
} from "./capa-investigation-active-advisory-contract";
import type {
  AuthoritativeS40InvestigationActiveContext,
  CapaInvestigationActiveAdvisoryContextAssembly,
  CapaInvestigationActiveAdvisoryContextResolution,
  CapaInvestigationActiveAdvisoryContextInvocation,
  CapaInvestigationActiveAdvisoryModelSafeReference,
  CapaInvestigationActiveAdvisoryReferenceManifestEntry,
} from "./capa-investigation-active-advisory-context";

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_MAXIMUM_REFERENCES = 100;

interface NormalizedUntrustedDraft {
  readonly ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);

  return actual.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    );
}

function normalizeUntrustedHumanDraft(
  value: unknown,
): NormalizedUntrustedDraft | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "trust",
      "evidence_assumption_ledger",
      "root_cause_package",
    ]) ||
    value.trust !== "untrusted_human_draft"
  ) {
    throw new Error("INVALID_UNTRUSTED_S40_HUMAN_DRAFT");
  }

  const ledger = validateCapaEvidenceAssumptionLedger(
    value.evidence_assumption_ledger,
  );

  if (ledger.status !== "valid") {
    throw new Error("INVALID_UNTRUSTED_S40_HUMAN_DRAFT");
  }

  const rootCause = validateCapaRootCausePackage(
    value.root_cause_package,
    ledger.value,
  );

  if (rootCause.status !== "valid") {
    throw new Error("INVALID_UNTRUSTED_S40_HUMAN_DRAFT");
  }

  return Object.freeze({
    ledger: ledger.value,
    root_cause_package: rootCause.value,
  });
}

function referenceKey(
  index: number,
): CapaInvestigationActiveAdvisoryReferenceKey {
  const number = index + 1;

  if (number < 1 || number > CAPA_INVESTIGATION_ACTIVE_ADVISORY_MAXIMUM_REFERENCES) {
    throw new Error("S40_REFERENCE_LIMIT_EXCEEDED");
  }

  return `R${number}` as
    CapaInvestigationActiveAdvisoryReferenceKey;
}

function freezeStringArray(
  values: readonly string[],
): readonly string[] {
  return Object.freeze([...values]);
}

function buildReferenceContext(
  plan: AuthoritativeS40InvestigationActiveContext["investigation_plan"],
  draft: NormalizedUntrustedDraft | null,
): Readonly<{
  manifest:
    readonly CapaInvestigationActiveAdvisoryReferenceManifestEntry[];
  modelReferences:
    readonly CapaInvestigationActiveAdvisoryModelSafeReference[];
}> {
  const manifest:
    CapaInvestigationActiveAdvisoryReferenceManifestEntry[] = [];

  const modelReferences:
    CapaInvestigationActiveAdvisoryModelSafeReference[] = [];

  let nextIndex = 0;

  const addManifest = (
    trust:
      CapaInvestigationActiveAdvisoryReferenceManifestEntry["trust"],
    sourceKind:
      CapaInvestigationActiveAdvisoryReferenceManifestEntry["source_kind"],
    sourceId: string,
  ): CapaInvestigationActiveAdvisoryReferenceKey => {
    const key = referenceKey(nextIndex);
    nextIndex += 1;

    manifest.push(Object.freeze({
      reference_key: key,
      trust,
      source_kind: sourceKind,
      source_id: sourceId,
    }));

    return key;
  };

  for (const item of plan.items) {
    const key = addManifest(
      "authoritative_server_context",
      "investigation_plan_item",
      item.item_id,
    );

    modelReferences.push(Object.freeze({
      reference_key: key,
      trust: "authoritative_server_context" as const,
      source_kind: "investigation_plan_item" as const,
      investigation_question: item.investigation_question,
      evidence_target: item.evidence_target,
      investigation_method: item.investigation_method,
      scope_relationship: item.scope_relationship,
      status: item.status,
      disposition: item.disposition,
      disposition_rationale: item.disposition_rationale,
    }));
  }

  if (draft !== null) {
    const ledgerReferenceById = new Map<
      string,
      CapaInvestigationActiveAdvisoryReferenceKey
    >();

    for (const item of draft.ledger.items) {
      const key = addManifest(
        "untrusted_human_draft",
        "ledger_item",
        item.item_id,
      );

      ledgerReferenceById.set(item.item_id, key);

      modelReferences.push(Object.freeze({
        reference_key: key,
        trust: "untrusted_human_draft" as const,
        source_kind: "ledger_item" as const,
        information_class: item.information_class,
        statement: item.statement,
        evidence_status: item.evidence_status,
        assumption_status: item.assumption_status,
        gap_status: item.gap_status,
        conflict_status: item.conflict_status,
        context: item.context,
        material_to_conclusion:
          item.material_to_conclusion,
        critical_to_conclusion:
          item.critical_to_conclusion,
        recommended_next_step:
          item.recommended_next_step,
      }));
    }

    const mappedLedgerReferences = (
      sourceIds: readonly string[],
    ): readonly CapaInvestigationActiveAdvisoryReferenceKey[] => {
      const mapped =
        sourceIds.map((sourceId) => {
          const value =
            ledgerReferenceById.get(sourceId);

          if (value === undefined) {
            throw new Error(
              "INVALID_UNTRUSTED_S40_HUMAN_DRAFT",
            );
          }

          return value;
        });

      return Object.freeze(mapped);
    };

    for (const hypothesis of
      draft.root_cause_package.hypotheses) {
      const key = addManifest(
        "untrusted_human_draft",
        "causal_hypothesis",
        hypothesis.hypothesis_id,
      );

      modelReferences.push(Object.freeze({
        reference_key: key,
        trust: "untrusted_human_draft" as const,
        source_kind: "causal_hypothesis" as const,
        statement: hypothesis.statement,
        status: hypothesis.status,
        causal_role: hypothesis.causal_role,
        rationale: hypothesis.rationale,
        supporting_reference_keys:
          mappedLedgerReferences(
            hypothesis.supporting_evidence_item_ids,
          ),
        contradictory_reference_keys:
          mappedLedgerReferences(
            hypothesis.contradictory_evidence_item_ids,
          ),
        linked_assumption_reference_keys:
          mappedLedgerReferences(
            hypothesis.linked_assumption_item_ids,
          ),
        linked_gap_reference_keys:
          mappedLedgerReferences(
            hypothesis.linked_gap_item_ids,
          ),
        linked_conflict_reference_keys:
          mappedLedgerReferences(
            hypothesis.linked_conflict_item_ids,
          ),
        material_to_package:
          hypothesis.material_to_package,
      }));
    }

    if (
      draft.root_cause_package.root_cause_not_confirmed !==
      null
    ) {
      const conclusion =
        draft.root_cause_package.root_cause_not_confirmed;

      const key = addManifest(
        "untrusted_human_draft",
        "root_cause_not_confirmed",
        "root_cause_not_confirmed",
      );

      modelReferences.push(Object.freeze({
        reference_key: key,
        trust: "untrusted_human_draft" as const,
        source_kind: "root_cause_not_confirmed" as const,
        rationale: conclusion.rationale,
        next_steps:
          freezeStringArray(conclusion.next_steps),
      }));
    }
  }

  if (
    manifest.length > CAPA_INVESTIGATION_ACTIVE_ADVISORY_MAXIMUM_REFERENCES ||
    modelReferences.length !== manifest.length
  ) {
    throw new Error("S40_REFERENCE_LIMIT_EXCEEDED");
  }

  return Object.freeze({
    manifest: Object.freeze(manifest),
    modelReferences: Object.freeze(modelReferences),
  });
}

export interface RepositoryCapaInvestigationActiveAdvisoryContextResolverDependencies {
  readonly repository: CapaRepository;
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly now: () => Date;
}

export class RepositoryCapaInvestigationActiveAdvisoryContextResolver {
  constructor(
    private readonly dependencies:
      RepositoryCapaInvestigationActiveAdvisoryContextResolverDependencies,
  ) {}

  async resolve(
    invocation:
      CapaInvestigationActiveAdvisoryContextInvocation,
  ): Promise<
    CapaInvestigationActiveAdvisoryContextResolution
  > {
    const principal =
      this.dependencies.authentication.principal;

    if (
      principal.principal_type !== "human" ||
      invocation.organization_id !==
        this.dependencies.tenant.organization_id
    ) {
      return { status: "not_found_or_not_authorized" };
    }

    let trustedNow: Date;

    try {
      trustedNow = this.dependencies.now();
    } catch {
      return { status: "invalid_authoritative_context" };
    }

    if (!Number.isFinite(trustedNow.getTime())) {
      return { status: "invalid_authoritative_context" };
    }

    const activeRoles = getActiveRoleAssignments(
      this.dependencies.tenant,
      trustedNow,
    );

    if (activeRoles.length === 0) {
      return { status: "not_found_or_not_authorized" };
    }

    try {
      const capaCase =
        await this.dependencies.repository.findCaseById(
          invocation.organization_id,
          invocation.capa_case_id,
        );

      if (
        capaCase === null ||
        capaCase.organization_id !==
          invocation.organization_id ||
        capaCase.capa_case_id !==
          invocation.capa_case_id ||
        capaCase.status !== "S40"
      ) {
        return capaCase === null ? { status: "not_found_or_not_authorized" } : { status: "wrong_workflow_state" };
      }

      const caseVersion =
        await this.dependencies.repository.findCaseVersionById(
          invocation.organization_id,
          invocation.capa_case_id,
          capaCase.current_version_id,
        );

      if (caseVersion !== null && caseVersion.status !== "S40") {
        return { status: "wrong_workflow_state" };
      }

      if (
        caseVersion === null ||
        caseVersion.organization_id !== invocation.organization_id ||
        caseVersion.capa_case_id !== invocation.capa_case_id ||
        caseVersion.case_version_id !== capaCase.current_version_id ||
        caseVersion.version_number !== capaCase.record_version ||
        new Set(caseVersion.section_version_ids).size !== caseVersion.section_version_ids.length
      ) {
        return { status: "invalid_authoritative_context" };
      }

      const sections = await Promise.all(
        caseVersion.section_version_ids.map(
          async (sectionVersionId) =>
            this.dependencies.repository
              .findSectionVersionById(
                invocation.organization_id,
                invocation.capa_case_id,
                sectionVersionId,
              ),
        ),
      );

      if (
        sections.some((section, index) =>
          section === null ||
          section.section_version_id !==
            caseVersion.section_version_ids[index] ||
          section.organization_id !==
            invocation.organization_id ||
          section.capa_case_id !==
            invocation.capa_case_id
        )
      ) {
        return { status: "invalid_authoritative_context" };
      }

      const typedSections =
        sections as CapaSectionVersion[];

      const planSections = typedSections.filter(
        (section) =>
          section.section_type ===
          CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
      );

      if (
        planSections.length !== 1 ||
        planSections[0]!.schema_version !==
          CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION
      ) {
        return { status: "invalid_authoritative_context" };
      }

      const plan = validateCapaInvestigationPlan(
        planSections[0]!.content,
      );

      if (plan.status !== "valid") {
        return { status: "invalid_authoritative_context" };
      }

      const draft = normalizeUntrustedHumanDraft(
        invocation.untrusted_human_draft,
      );

      const authoritative = Object.freeze({
        trust:
          "authoritative_server_context" as const,
        organization_id:
          capaCase.organization_id,
        capa_case_id:
          capaCase.capa_case_id,
        case_version_id:
          caseVersion.case_version_id,
        record_version:
          caseVersion.version_number,
        workflow_state: "S40" as const,
        actor: principal.user_id,
        active_roles: Object.freeze(
          activeRoles.map((role) =>
            Object.freeze({ ...role }),
          ),
        ),
        investigation_plan: plan.value,
      });

      const references = buildReferenceContext(
        authoritative.investigation_plan,
        draft,
      );

      return { status: "resolved", assembly: Object.freeze({
        authoritative,
        reference_manifest: references.manifest,
        model_safe_context: Object.freeze({
          trust: "model_safe_context" as const,
          workflow_state: "S40" as const,
          references:
            references.modelReferences,
        }),
      }) };
    } catch {
      return { status: "invalid_authoritative_context" };
    }
  }

  async assertCaseUnchanged(
    context:
      AuthoritativeS40InvestigationActiveContext,
  ): Promise<boolean> {
    try {
      const capaCase =
        await this.dependencies.repository.findCaseById(
          context.organization_id,
          context.capa_case_id,
        );

      if (
        capaCase === null ||
        capaCase.organization_id !==
          context.organization_id ||
        capaCase.capa_case_id !==
          context.capa_case_id ||
        capaCase.current_version_id !==
          context.case_version_id ||
        capaCase.record_version !==
          context.record_version ||
        capaCase.status !==
          context.workflow_state
      ) {
        return false;
      }

      const caseVersion =
        await this.dependencies.repository.findCaseVersionById(
          context.organization_id,
          context.capa_case_id,
          context.case_version_id,
        );

      return caseVersion !== null &&
        caseVersion.organization_id ===
          context.organization_id &&
        caseVersion.capa_case_id ===
          context.capa_case_id &&
        caseVersion.case_version_id ===
          context.case_version_id &&
        caseVersion.version_number ===
          context.record_version &&
        caseVersion.status ===
          context.workflow_state;
    } catch {
      return false;
    }
  }
}
