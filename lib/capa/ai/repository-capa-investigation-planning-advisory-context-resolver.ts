import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { AuthenticationContext } from "../../security/auth-context";
import {
  getActiveRoleAssignments,
  type TenantContext,
} from "../../security/tenant-context";
import {
  CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,
  CAPA_CONTAINMENT_RISK_SECTION_TYPE,
  validateCapaContainmentRiskContent,
} from "../domain/capa-containment-risk";
import {
  CAPA_SCOPE_SCHEMA_VERSION,
  CAPA_SCOPE_SECTION_TYPE,
  validateCapaScopeContent,
} from "../domain/capa-scope";
import type {
  CapaSectionVersion,
  ControlledCode,
} from "../domain/capa-types";
import type {
  AuthoritativeS30InvestigationPlanningContext,
  CapaInvestigationPlanningAdvisoryContextAssembly,
  CapaInvestigationPlanningAdvisoryContextInvocation,
  CapaInvestigationPlanningAdvisoryHumanDraft,
  CapaInvestigationPlanningAdvisoryHumanDraftItem,
} from "./capa-investigation-planning-advisory-context";

const MAXIMUM_DRAFT_ITEMS = 20;
const MAXIMUM_DRAFT_DEPENDENCIES = 20;
const MAXIMUM_DRAFT_TEXT_CHARACTERS = 4_000;
const DRAFT_LOCAL_KEY_PATTERN = /^D[1-9][0-9]{0,2}$/;

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

function draftText(
  value: unknown,
): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > MAXIMUM_DRAFT_TEXT_CHARACTERS) {
    return undefined;
  }

  return normalized.length === 0 ? null : normalized;
}

function draftLocalKey(
  value: unknown,
): string | undefined {
  return typeof value === "string" &&
    DRAFT_LOCAL_KEY_PATTERN.test(value)
    ? value
    : undefined;
}

function normalizeUntrustedHumanDraft(
  value: unknown,
): CapaInvestigationPlanningAdvisoryHumanDraft | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["trust", "content"]) ||
    value.trust !== "untrusted_human_draft" ||
    !isRecord(value.content) ||
    !hasExactKeys(value.content, ["items"]) ||
    !Array.isArray(value.content.items) ||
    value.content.items.length > MAXIMUM_DRAFT_ITEMS
  ) {
    throw new Error("INVALID_UNTRUSTED_S30_HUMAN_DRAFT");
  }

  const localKeys = new Set<string>();
  const sourceItems = value.content.items;

  for (const source of sourceItems) {
    if (
      !isRecord(source) ||
      !hasExactKeys(source, [
        "local_key",
        "investigation_question",
        "evidence_target",
        "investigation_method",
        "scope_relationship",
        "due_date_consideration",
        "dependency_local_keys",
        "owner_selected",
      ])
    ) {
      throw new Error("INVALID_UNTRUSTED_S30_HUMAN_DRAFT");
    }

    const localKey = draftLocalKey(source.local_key);
    if (localKey === undefined || localKeys.has(localKey)) {
      throw new Error("INVALID_UNTRUSTED_S30_HUMAN_DRAFT");
    }
    localKeys.add(localKey);
  }

  const items: CapaInvestigationPlanningAdvisoryHumanDraftItem[] = [];

  for (const source of sourceItems) {
    const localKey = source.local_key as string;
    const question = draftText(source.investigation_question);
    const evidenceTarget = draftText(source.evidence_target);
    const method = draftText(source.investigation_method);
    const scope = draftText(source.scope_relationship);
    const dueDate = draftText(source.due_date_consideration);

    if (
      question === undefined ||
      evidenceTarget === undefined ||
      method === undefined ||
      scope === undefined ||
      dueDate === undefined ||
      typeof source.owner_selected !== "boolean" ||
      !Array.isArray(source.dependency_local_keys) ||
      source.dependency_local_keys.length > MAXIMUM_DRAFT_DEPENDENCIES
    ) {
      throw new Error("INVALID_UNTRUSTED_S30_HUMAN_DRAFT");
    }

    const dependencies: string[] = [];
    for (const dependency of source.dependency_local_keys) {
      if (
        draftLocalKey(dependency) === undefined ||
        !localKeys.has(dependency) ||
        dependency === localKey ||
        dependencies.includes(dependency)
      ) {
        throw new Error("INVALID_UNTRUSTED_S30_HUMAN_DRAFT");
      }
      dependencies.push(dependency);
    }

    items.push(Object.freeze({
      local_key: localKey,
      investigation_question: question,
      evidence_target: evidenceTarget,
      investigation_method: method,
      scope_relationship: scope,
      due_date_consideration: dueDate,
      dependency_local_keys: Object.freeze(dependencies),
      owner_selected: source.owner_selected,
    }));
  }

  const graph = new Map(
    items.map((item) => [item.local_key, item.dependency_local_keys]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function hasCycle(localKey: string): boolean {
    if (visiting.has(localKey)) return true;
    if (visited.has(localKey)) return false;
    visiting.add(localKey);
    for (const dependency of graph.get(localKey) ?? []) {
      if (hasCycle(dependency)) return true;
    }
    visiting.delete(localKey);
    visited.add(localKey);
    return false;
  }

  if (items.some((item) => hasCycle(item.local_key))) {
    throw new Error("INVALID_UNTRUSTED_S30_HUMAN_DRAFT");
  }

  return Object.freeze({
    trust: "untrusted_human_draft" as const,
    content: Object.freeze({
      items: Object.freeze(items),
    }),
  });
}

function requiredText(
  value: unknown,
  maximumCharacters: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFKC").trim();
  return normalized.length > 0 &&
    normalized.length <= maximumCharacters
    ? normalized
    : undefined;
}

function intakeSnapshot(
  section: CapaSectionVersion,
): AuthoritativeS30InvestigationPlanningContext["intake_scope"] | null {
  const content = section.content;
  if (
    !hasExactKeys(content, [
      "initiating_event",
      "source",
      "organization_reference",
    ]) ||
    !isRecord(content.source)
  ) {
    return null;
  }

  const initiatingEvent = requiredText(
    content.initiating_event,
    4_000,
  );
  const organizationReference = requiredText(
    content.organization_reference,
    100,
  );
  const source = content.source;
  if (
    initiatingEvent === undefined ||
    organizationReference === undefined ||
    !hasExactKeys(source, ["source_type", "source_reference"])
  ) {
    return null;
  }

  const sourceType = requiredText(source.source_type, 64);
  const sourceReference = source.source_reference === null
    ? null
    : requiredText(source.source_reference, 500);
  if (
    sourceType === undefined ||
    sourceReference === undefined
  ) {
    return null;
  }

  return Object.freeze({
    initiating_event: initiatingEvent,
    source: Object.freeze({
      source_type: sourceType,
      source_reference: sourceReference,
    }),
    organization_reference: organizationReference,
  });
}

export interface RepositoryCapaInvestigationPlanningAdvisoryContextResolverDependencies {
  readonly repository: CapaRepository;
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly intake_section_type: ControlledCode;
  readonly intake_schema_version?: string;
  readonly now: () => Date;
}

export class RepositoryCapaInvestigationPlanningAdvisoryContextResolver {
  constructor(
    private readonly dependencies:
      RepositoryCapaInvestigationPlanningAdvisoryContextResolverDependencies,
  ) {}

  async resolve(
    invocation: CapaInvestigationPlanningAdvisoryContextInvocation,
  ): Promise<CapaInvestigationPlanningAdvisoryContextAssembly | null> {
    const principal = this.dependencies.authentication.principal;
    if (
      principal.principal_type !== "human" ||
      invocation.organization_id !== this.dependencies.tenant.organization_id
    ) {
      return null;
    }

    let trustedNow: Date;
    try {
      trustedNow = this.dependencies.now();
    } catch {
      return null;
    }

    if (!Number.isFinite(trustedNow.getTime())) return null;

    const activeRoles = getActiveRoleAssignments(
      this.dependencies.tenant,
      trustedNow,
    );
    if (activeRoles.length === 0) return null;

    try {
      const capaCase = await this.dependencies.repository.findCaseById(
        invocation.organization_id,
        invocation.capa_case_id,
      );

      if (
        capaCase === null ||
        capaCase.organization_id !== invocation.organization_id ||
        capaCase.capa_case_id !== invocation.capa_case_id ||
        capaCase.status !== "S30"
      ) {
        return null;
      }

      const caseVersion = await this.dependencies.repository.findCaseVersionById(
        invocation.organization_id,
        invocation.capa_case_id,
        capaCase.current_version_id,
      );

      if (
        caseVersion === null ||
        caseVersion.organization_id !== invocation.organization_id ||
        caseVersion.capa_case_id !== invocation.capa_case_id ||
        caseVersion.case_version_id !== capaCase.current_version_id ||
        caseVersion.status !== "S30" ||
        caseVersion.version_number !== capaCase.record_version ||
        new Set(caseVersion.section_version_ids).size !==
          caseVersion.section_version_ids.length
      ) {
        return null;
      }

      const sections = await Promise.all(
        caseVersion.section_version_ids.map(async (sectionVersionId) =>
          this.dependencies.repository.findSectionVersionById(
            invocation.organization_id,
            invocation.capa_case_id,
            sectionVersionId,
          )
        ),
      );

      if (
        sections.some((section, index) =>
          section === null ||
          section.section_version_id !== caseVersion.section_version_ids[index] ||
          section.organization_id !== invocation.organization_id ||
          section.capa_case_id !== invocation.capa_case_id
        )
      ) {
        return null;
      }

      const typedSections = sections as CapaSectionVersion[];
      const intakeSections = typedSections.filter(
        (section) => section.section_type === this.dependencies.intake_section_type,
      );
      const scopeSections = typedSections.filter(
        (section) => section.section_type === CAPA_SCOPE_SECTION_TYPE,
      );
      const riskSections = typedSections.filter(
        (section) => section.section_type === CAPA_CONTAINMENT_RISK_SECTION_TYPE,
      );

      if (
        intakeSections.length !== 1 ||
        scopeSections.length !== 1 ||
        riskSections.length !== 1 ||
        (this.dependencies.intake_schema_version !== undefined &&
          intakeSections[0]?.schema_version !== this.dependencies.intake_schema_version) ||
        scopeSections[0]?.schema_version !== CAPA_SCOPE_SCHEMA_VERSION ||
        riskSections[0]?.schema_version !== CAPA_CONTAINMENT_RISK_SCHEMA_VERSION
      ) {
        return null;
      }

      const intake = intakeSnapshot(intakeSections[0]!);
      const scope = validateCapaScopeContent(scopeSections[0]!.content);
      const risk = validateCapaContainmentRiskContent(riskSections[0]!.content);

      if (
        intake === null ||
        scope.status !== "valid" ||
        risk.status !== "valid"
      ) {
        return null;
      }

      const draft = normalizeUntrustedHumanDraft(
        invocation.untrusted_human_draft,
      );

      const authoritative = Object.freeze({
        trust: "authoritative_server_context" as const,
        organization_id: capaCase.organization_id,
        capa_case_id: capaCase.capa_case_id,
        case_version_id: caseVersion.case_version_id,
        record_version: caseVersion.version_number,
        workflow_state: "S30" as const,
        actor: principal.user_id,
        active_roles: Object.freeze(
          activeRoles.map((role) => Object.freeze({ ...role })),
        ),
        intake_scope: intake,
        accepted_scope: scope.value,
        accepted_containment_risk: risk.value,
      });

      return Object.freeze({
        authoritative,
        untrusted_human_draft: draft,
      });
    } catch {
      return null;
    }
  }

  async assertCaseUnchanged(
    context: AuthoritativeS30InvestigationPlanningContext,
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

      const caseVersion = await this.dependencies.repository.findCaseVersionById(
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
