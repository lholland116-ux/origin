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
  CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
  CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE,
  validateCapaEvidenceAssumptionLedger,
  type CapaEvidenceAssumptionLedgerContent,
} from "../domain/capa-evidence-assumption-ledger";
import {
  CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
  validateCapaInvestigationPlan,
  type CapaInvestigationPlanContent,
} from "../domain/capa-investigation-plan";
import {
  CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
  validateCapaRootCausePackage,
  type CapaRootCausePackageContent,
} from "../domain/capa-root-cause-package";
import type {
  CapaSectionVersion,
  ControlledCode,
} from "../domain/capa-types";
import type {
  AuthoritativeS50RootCauseReviewContext,
  CapaRootCauseReviewAdvisoryContextAssembly,
  CapaRootCauseReviewAdvisoryContextInvocation,
  CapaRootCauseReviewAdvisoryContextResolution,
  CapaRootCauseReviewAdvisoryHypothesisReference,
  CapaRootCauseReviewAdvisoryLedgerReference,
  CapaRootCauseReviewAdvisoryModelSafeReference,
  CapaRootCauseReviewAdvisoryNotConfirmedReference,
  CapaRootCauseReviewAdvisoryPlanReference,
  CapaRootCauseReviewAdvisoryReferenceManifestEntry,
  CapaRootCauseReviewAdvisoryReferenceSourceKind,
  CapaRootCauseReviewAdvisorySectionSnapshot,
} from "./capa-root-cause-review-advisory-context";
import type {
  CapaRootCauseReviewAdvisoryReferenceKey,
} from "./capa-root-cause-review-advisory-contract";

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MAXIMUM_REFERENCES = 200;

interface ValidatedMaterial {
  readonly ledger: CapaRootCauseReviewAdvisorySectionSnapshot<CapaEvidenceAssumptionLedgerContent>;
  readonly root_cause_package: CapaRootCauseReviewAdvisorySectionSnapshot<CapaRootCausePackageContent>;
  readonly investigation_plan: CapaRootCauseReviewAdvisorySectionSnapshot<CapaInvestigationPlanContent> | null;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freeze(child);
    }
  }
  return value;
}

function sectionSnapshot<Content>(
  section: CapaSectionVersion,
  content: Content,
): CapaRootCauseReviewAdvisorySectionSnapshot<Content> {
  return freeze({
    section_version_id: section.section_version_id,
    section_type: section.section_type,
    section_version_number: section.version_number,
    schema_version: section.schema_version,
    content,
  });
}

function sectionsHaveExactIds(
  sectionIds: readonly string[],
): boolean {
  return Array.isArray(sectionIds) &&
    new Set(sectionIds).size === sectionIds.length;
}

function loadSections(
  repository: CapaRepository,
  organizationId: AuthoritativeS50RootCauseReviewContext["organization_id"],
  capaCaseId: AuthoritativeS50RootCauseReviewContext["capa_case_id"],
  sectionIds: readonly string[],
): Promise<readonly CapaSectionVersion[]> {
  return Promise.all(
    sectionIds.map((sectionId) =>
      repository.findSectionVersionById(
        organizationId,
        capaCaseId,
        sectionId as never,
      ),
    ),
  ).then((sections) => {
    if (
      sections.some((section, index) =>
        section === null ||
        section.section_version_id !== sectionIds[index] ||
        section.organization_id !== organizationId ||
        section.capa_case_id !== capaCaseId,
      )
    ) {
      throw new Error("INVALID_S50_SECTION_BINDING");
    }

    return sections as CapaSectionVersion[];
  });
}

function requiredSection(
  sections: readonly CapaSectionVersion[],
  sectionType: ControlledCode,
  schemaVersion: string,
): CapaSectionVersion {
  const matches = sections.filter(
    (section) => section.section_type === sectionType,
  );

  if (
    matches.length !== 1 ||
    matches[0]!.schema_version !== schemaVersion
  ) {
    throw new Error("INVALID_S50_REQUIRED_SECTION");
  }

  return matches[0]!;
}

function optionalPlanSection(
  sections: readonly CapaSectionVersion[],
): CapaSectionVersion | null {
  const matches = sections.filter(
    (section) =>
      section.section_type === CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
  );

  if (matches.length > 1) {
    throw new Error("INVALID_S50_PLAN_SECTION");
  }

  if (
    matches.length === 1 &&
    matches[0]!.schema_version !== CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION
  ) {
    throw new Error("INVALID_S50_PLAN_SECTION");
  }

  return matches[0] ?? null;
}

function validateMaterial(
  sections: readonly CapaSectionVersion[],
  required: boolean,
): ValidatedMaterial | null {
  const ledgerMatches = sections.filter(
    (section) =>
      section.section_type ===
      CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE,
  );
  const rootCauseMatches = sections.filter(
    (section) =>
      section.section_type === CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
  );

  if (
    !required &&
    (ledgerMatches.length === 0 || rootCauseMatches.length === 0)
  ) {
    return null;
  }

  if (
    ledgerMatches.length !== 1 ||
    rootCauseMatches.length !== 1 ||
    ledgerMatches[0]!.schema_version !==
      CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION ||
    rootCauseMatches[0]!.schema_version !==
      CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION
  ) {
    throw new Error("INVALID_S50_REVIEW_MATERIAL");
  }

  const ledger = validateCapaEvidenceAssumptionLedger(
    ledgerMatches[0]!.content,
  );

  if (ledger.status !== "valid") {
    throw new Error("INVALID_S50_REVIEW_MATERIAL");
  }

  const rootCause = validateCapaRootCausePackage(
    rootCauseMatches[0]!.content,
    ledger.value,
  );

  if (rootCause.status !== "valid") {
    throw new Error("INVALID_S50_REVIEW_MATERIAL");
  }

  const planSection = optionalPlanSection(sections);
  let plan: CapaInvestigationPlanContent | null = null;

  if (planSection !== null) {
    const validatedPlan = validateCapaInvestigationPlan(
      planSection.content,
    );
    if (validatedPlan.status !== "valid") {
      throw new Error("INVALID_S50_REVIEW_MATERIAL");
    }
    plan = validatedPlan.value;
  }

  return freeze({
    ledger: sectionSnapshot(
      ledgerMatches[0]!,
      ledger.value,
    ),
    root_cause_package: sectionSnapshot(
      rootCauseMatches[0]!,
      rootCause.value,
    ),
    investigation_plan: planSection === null || plan === null
      ? null
      : sectionSnapshot(planSection, plan),
  });
}

interface ReferenceBuildResult {
  readonly manifest: readonly CapaRootCauseReviewAdvisoryReferenceManifestEntry[];
  readonly modelReferences: readonly CapaRootCauseReviewAdvisoryModelSafeReference[];
}

function referenceKey(
  index: number,
): CapaRootCauseReviewAdvisoryReferenceKey {
  const number = index + 1;
  if (
    number < 1 ||
    number > CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MAXIMUM_REFERENCES
  ) {
    throw new Error("S50_REFERENCE_LIMIT_EXCEEDED");
  }
  return `R${number}` as CapaRootCauseReviewAdvisoryReferenceKey;
}

function buildReferences(
  material: ValidatedMaterial,
  versionScope: "current" | "comparison",
  startIndex: number,
): ReferenceBuildResult {
  const manifest: CapaRootCauseReviewAdvisoryReferenceManifestEntry[] = [];
  const modelReferences: CapaRootCauseReviewAdvisoryModelSafeReference[] = [];
  const ledgerReferenceById = new Map<string, CapaRootCauseReviewAdvisoryReferenceKey>();
  let nextIndex = startIndex;

  const add = (
    sourceKind: CapaRootCauseReviewAdvisoryReferenceSourceKind,
    sourceId: string,
  ): CapaRootCauseReviewAdvisoryReferenceKey => {
    const key = referenceKey(nextIndex);
    nextIndex += 1;
    manifest.push(freeze({
      reference_key: key,
      trust: "authoritative_server_context" as const,
      source_kind: sourceKind,
      source_id: sourceId,
      version_scope: versionScope,
    }));
    return key;
  };

  for (const item of material.ledger.content.items) {
    const key = add("ledger_item", item.item_id);
    ledgerReferenceById.set(item.item_id, key);
    modelReferences.push(freeze({
      reference_key: key,
      trust: "authoritative_server_context" as const,
      source_kind: "ledger_item" as const,
      version_scope: versionScope,
      information_class: item.information_class,
      statement: item.statement,
      evidence_status: item.evidence_status,
      assumption_status: item.assumption_status,
      gap_status: item.gap_status,
      conflict_status: item.conflict_status,
      source_version: item.source_version,
      context: item.context,
      material_to_conclusion: item.material_to_conclusion,
      critical_to_conclusion: item.critical_to_conclusion,
      recommended_next_step: item.recommended_next_step,
    } satisfies CapaRootCauseReviewAdvisoryLedgerReference));
  }

  const mappedLedgerReferences = (
    ids: readonly string[],
  ): readonly CapaRootCauseReviewAdvisoryReferenceKey[] => {
    const mapped = ids.map((id) => {
      const key = ledgerReferenceById.get(id);
      if (key === undefined) {
        throw new Error("INVALID_S50_REFERENCE_BINDING");
      }
      return key;
    });
    return Object.freeze(mapped);
  };

  for (const hypothesis of material.root_cause_package.content.hypotheses) {
    const key = add("causal_hypothesis", hypothesis.hypothesis_id);
    modelReferences.push(freeze({
      reference_key: key,
      trust: "authoritative_server_context" as const,
      source_kind: "causal_hypothesis" as const,
      version_scope: versionScope,
      statement: hypothesis.statement,
      status: hypothesis.status,
      causal_role: hypothesis.causal_role,
      rationale: hypothesis.rationale,
      supporting_reference_keys: mappedLedgerReferences(
        hypothesis.supporting_evidence_item_ids,
      ),
      contradictory_reference_keys: mappedLedgerReferences(
        hypothesis.contradictory_evidence_item_ids,
      ),
      linked_assumption_reference_keys: mappedLedgerReferences(
        hypothesis.linked_assumption_item_ids,
      ),
      linked_gap_reference_keys: mappedLedgerReferences(
        hypothesis.linked_gap_item_ids,
      ),
      linked_conflict_reference_keys: mappedLedgerReferences(
        hypothesis.linked_conflict_item_ids,
      ),
      material_to_package: hypothesis.material_to_package,
    } satisfies CapaRootCauseReviewAdvisoryHypothesisReference));
  }

  if (
    material.root_cause_package.content.root_cause_not_confirmed !== null
  ) {
    const conclusion =
      material.root_cause_package.content.root_cause_not_confirmed;
    const key = add(
      "root_cause_not_confirmed",
      "root_cause_not_confirmed",
    );
    modelReferences.push(freeze({
      reference_key: key,
      trust: "authoritative_server_context" as const,
      source_kind: "root_cause_not_confirmed" as const,
      version_scope: versionScope,
      rationale: conclusion.rationale,
      next_steps: Object.freeze([...conclusion.next_steps]),
    } satisfies CapaRootCauseReviewAdvisoryNotConfirmedReference));
  }

  if (material.investigation_plan !== null) {
    for (const item of material.investigation_plan.content.items) {
      const key = add("investigation_plan_item", item.item_id);
      modelReferences.push(freeze({
        reference_key: key,
        trust: "authoritative_server_context" as const,
        source_kind: "investigation_plan_item" as const,
        version_scope: versionScope,
        investigation_question: item.investigation_question,
        evidence_target: item.evidence_target,
        investigation_method: item.investigation_method,
        scope_relationship: item.scope_relationship,
        status: item.status,
        disposition: item.disposition,
        disposition_rationale: item.disposition_rationale,
      } satisfies CapaRootCauseReviewAdvisoryPlanReference));
    }
  }

  return freeze({
    manifest: Object.freeze(manifest),
    modelReferences: Object.freeze(modelReferences),
  });
}

function safeSectionVersions(
  material: ValidatedMaterial,
): Readonly<{
  readonly investigation_ledger: string;
  readonly root_cause_package: string;
  readonly investigation_plan: string | null;
}> {
  return freeze({
    investigation_ledger: material.ledger.schema_version,
    root_cause_package: material.root_cause_package.schema_version,
    investigation_plan:
      material.investigation_plan?.schema_version ?? null,
  });
}

function buildAssembly(
  authoritative: AuthoritativeS50RootCauseReviewContext,
  currentMaterial: ValidatedMaterial,
  comparisonMaterial: ValidatedMaterial | null,
): CapaRootCauseReviewAdvisoryContextAssembly {
  const currentReferences = buildReferences(
    currentMaterial,
    "current",
    0,
  );
  const comparisonReferences = comparisonMaterial === null
    ? { manifest: [], modelReferences: [] }
    : buildReferences(
      comparisonMaterial,
      "comparison",
      currentReferences.manifest.length,
    );

  return freeze({
    authoritative,
    reference_manifest: Object.freeze([
      ...currentReferences.manifest,
      ...comparisonReferences.manifest,
    ]),
    model_safe_context: {
      trust: "model_safe_context" as const,
      workflow_state: "S50" as const,
      current_version_number: authoritative.case_version.version_number,
      comparison_version_number:
        authoritative.comparison_version?.version_number ?? null,
      current_section_versions: safeSectionVersions(currentMaterial),
      comparison_section_versions:
        comparisonMaterial === null
          ? null
          : safeSectionVersions(comparisonMaterial),
      references: Object.freeze([
        ...currentReferences.modelReferences,
        ...comparisonReferences.modelReferences,
      ]),
    },
  });
}

export interface RepositoryCapaRootCauseReviewAdvisoryContextResolverDependencies {
  readonly repository: CapaRepository;
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly now: () => Date;
}

export class RepositoryCapaRootCauseReviewAdvisoryContextResolver {
  constructor(
    private readonly dependencies:
      RepositoryCapaRootCauseReviewAdvisoryContextResolverDependencies,
  ) {}

  async resolve(
    invocation: CapaRootCauseReviewAdvisoryContextInvocation,
  ): Promise<CapaRootCauseReviewAdvisoryContextResolution> {
    const principal = this.dependencies.authentication.principal;

    if (
      principal.principal_type !== "human" ||
      invocation.organization_id !== this.dependencies.tenant.organization_id
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
      const capaCase = await this.dependencies.repository.findCaseById(
        invocation.organization_id,
        invocation.capa_case_id,
      );

      if (
        capaCase === null ||
        capaCase.organization_id !== invocation.organization_id ||
        capaCase.capa_case_id !== invocation.capa_case_id
      ) {
        return { status: "not_found_or_not_authorized" };
      }

      if (capaCase.status !== "S50") {
        return { status: "wrong_workflow_state" };
      }

      const caseVersion =
        await this.dependencies.repository.findCaseVersionById(
          invocation.organization_id,
          invocation.capa_case_id,
          capaCase.current_version_id,
        );

      if (
        caseVersion === null ||
        caseVersion.organization_id !== invocation.organization_id ||
        caseVersion.capa_case_id !== invocation.capa_case_id ||
        caseVersion.case_version_id !== capaCase.current_version_id ||
        caseVersion.status !== "S50" ||
        caseVersion.version_number !== capaCase.record_version ||
        !Number.isSafeInteger(caseVersion.version_number) ||
        caseVersion.version_number < 1 ||
        !sectionsHaveExactIds(caseVersion.section_version_ids)
      ) {
        return { status: "invalid_authoritative_context" };
      }

      const currentSections = await loadSections(
        this.dependencies.repository,
        invocation.organization_id,
        invocation.capa_case_id,
        caseVersion.section_version_ids,
      );
      const currentMaterial = validateMaterial(currentSections, true);
      if (currentMaterial === null) {
        return { status: "invalid_authoritative_context" };
      }

      let comparisonVersion:
        AuthoritativeS50RootCauseReviewContext["comparison_version"] = null;
      let comparisonMaterial: ValidatedMaterial | null = null;

      if (caseVersion.parent_version_id !== undefined &&
          caseVersion.parent_version_id !== null) {
        const parent = await this.dependencies.repository.findCaseVersionById(
          invocation.organization_id,
          invocation.capa_case_id,
          caseVersion.parent_version_id,
        );

        if (
          parent === null ||
          parent.organization_id !== invocation.organization_id ||
          parent.capa_case_id !== invocation.capa_case_id ||
          parent.case_version_id !== caseVersion.parent_version_id ||
          !Number.isSafeInteger(parent.version_number) ||
          parent.version_number < 1 ||
          parent.version_number >= caseVersion.version_number ||
          !sectionsHaveExactIds(parent.section_version_ids)
        ) {
          return { status: "invalid_authoritative_context" };
        }

        const parentSections = await loadSections(
          this.dependencies.repository,
          invocation.organization_id,
          invocation.capa_case_id,
          parent.section_version_ids,
        );
        comparisonMaterial = validateMaterial(parentSections, false);

        if (comparisonMaterial !== null) {
          comparisonVersion = freeze({
            version_number: parent.version_number,
            case_version_id: parent.case_version_id,
            sections: {
              investigation_ledger: comparisonMaterial.ledger,
              root_cause_package: comparisonMaterial.root_cause_package,
              investigation_plan: comparisonMaterial.investigation_plan,
            },
          });
        }
      }

      const authoritative: AuthoritativeS50RootCauseReviewContext = freeze({
        trust: "authoritative_server_context" as const,
        organization_id: capaCase.organization_id,
        capa_case_id: capaCase.capa_case_id,
        case_version_id: caseVersion.case_version_id,
        record_version: caseVersion.version_number,
        workflow_state: "S50" as const,
        actor: principal.user_id,
        active_roles: Object.freeze(
          activeRoles.map((role) => Object.freeze({ ...role })),
        ),
        case_version: {
          version_number: caseVersion.version_number,
          parent_version_id: caseVersion.parent_version_id ?? null,
          change_reason: caseVersion.change_reason,
        },
        sections: {
          investigation_ledger: currentMaterial.ledger,
          root_cause_package: currentMaterial.root_cause_package,
          investigation_plan: currentMaterial.investigation_plan,
        },
        comparison_version: comparisonVersion,
      });

      return {
        status: "resolved",
        assembly: buildAssembly(
          authoritative,
          currentMaterial,
          comparisonMaterial,
        ),
      };
    } catch (error) {
      return { status: "invalid_authoritative_context" };
    }
  }

  async assertCaseUnchanged(
    context: AuthoritativeS50RootCauseReviewContext,
  ): Promise<boolean> {
    try {
      const capaCase = await this.dependencies.repository.findCaseById(
        context.organization_id,
        context.capa_case_id,
      );

      if (
        capaCase === null ||
        capaCase.organization_id !== context.organization_id ||
        capaCase.capa_case_id !== context.capa_case_id ||
        capaCase.current_version_id !== context.case_version_id ||
        capaCase.record_version !== context.record_version ||
        capaCase.status !== context.workflow_state
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
        caseVersion.organization_id === context.organization_id &&
        caseVersion.capa_case_id === context.capa_case_id &&
        caseVersion.case_version_id === context.case_version_id &&
        caseVersion.version_number === context.record_version &&
        caseVersion.status === context.workflow_state;
    } catch {
      return false;
    }
  }
}
