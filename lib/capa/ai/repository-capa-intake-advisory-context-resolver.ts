import type {
  ControlledCode,
  RoleId,
} from "../domain/capa-types";

import type {
  CapaIntakeAdvisoryCaseContext,
  CapaIntakeAdvisoryContextResolver,
  CapaIntakeAdvisoryIntegrityGuard,
  CapaIntakeAdvisoryInvocation,
} from "./capa-intake-advisory-service";

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

/**
 * Trusted repository-backed context resolution for one current S10 CAPA.
 * Browser data cannot supply state, version, roles, tenant or case content.
 */

export interface RepositoryCapaIntakeAdvisoryContextResolverDependencies {
  readonly repository: CapaRepository;
  readonly authentication:
    AuthenticationContext;
  readonly tenant: TenantContext;
  readonly intake_section_type:
    ControlledCode;
  readonly now: () => Date;
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

export class RepositoryCapaIntakeAdvisoryContextResolver
  implements
    CapaIntakeAdvisoryContextResolver,
    CapaIntakeAdvisoryIntegrityGuard {
  constructor(
    private readonly dependencies:
      RepositoryCapaIntakeAdvisoryContextResolverDependencies,
  ) {}

  async resolve(
    invocation:
      CapaIntakeAdvisoryInvocation,
  ): Promise<
    CapaIntakeAdvisoryCaseContext | null
  > {
    const principal =
      this.dependencies.authentication
        .principal;

    if (
      principal.principal_type !== "human" ||
      principal.user_id !==
        invocation.user_id ||
      invocation.organization_id !==
        this.dependencies.tenant
          .organization_id
    ) {
      return null;
    }

    let trustedNow: Date;

    try {
      trustedNow = this.dependencies.now();
    } catch {
      return null;
    }

    if (
      !Number.isFinite(
        trustedNow.getTime(),
      )
    ) {
      return null;
    }

    const capaCase =
      await this.dependencies.repository
        .findCaseById(
          invocation.organization_id,
          invocation.capa_case_id,
        );

    if (
      capaCase === null ||
      capaCase.organization_id !==
        invocation.organization_id ||
      capaCase.status !== "S10"
    ) {
      return null;
    }

    const caseVersion =
      await this.dependencies.repository
        .findCaseVersionById(
          invocation.organization_id,
          invocation.capa_case_id,
          capaCase.current_version_id,
        );

    if (
      caseVersion === null ||
      caseVersion.organization_id !==
        invocation.organization_id ||
      caseVersion.capa_case_id !==
        invocation.capa_case_id ||
      caseVersion.case_version_id !==
        capaCase.current_version_id ||
      caseVersion.status !== "S10" ||
      caseVersion.version_number !==
        capaCase.record_version
    ) {
      return null;
    }

    const sections =
      await Promise.all(
        caseVersion.section_version_ids.map(
          (sectionVersionId) =>
            this.dependencies.repository
              .findSectionVersionById(
                invocation.organization_id,
                invocation.capa_case_id,
                sectionVersionId,
              ),
        ),
      );

    if (
      sections.some(
        (section) => section === null,
      )
    ) {
      return null;
    }

    const intakeSections =
      sections.filter(
        (section) =>
          section !== null &&
          section.organization_id ===
            invocation.organization_id &&
          section.capa_case_id ===
            invocation.capa_case_id &&
          section.section_type ===
            this.dependencies
              .intake_section_type &&
          isRecord(section.content),
      );

    if (intakeSections.length !== 1) {
      return null;
    }

    const intake = intakeSections[0];

    if (
      intake === undefined ||
      intake === null ||
      !isRecord(intake.content)
    ) {
      return null;
    }

    const roles =
      getActiveRoleAssignments(
        this.dependencies.tenant,
        trustedNow,
      ).map(
        (assignment) =>
          assignment.role_id as RoleId,
      );

    return Object.freeze({
      organization_id:
        invocation.organization_id,
      capa_case_id:
        invocation.capa_case_id,
      case_version_id:
        caseVersion.case_version_id,
      record_version:
        caseVersion.version_number,
      workflow_state: "S10",
      user_id: invocation.user_id,
      active_role_ids:
        Object.freeze([...roles]),
      minimum_case_context:
        Object.freeze([
          Object.freeze({
            field_code: "intake.initiating_event" as ControlledCode,
            value:
              intake.content
                .initiating_event,
            source_object_id:
              intake.section_version_id,
            source_object_version_id:
              intake.section_version_id,
          }),
          Object.freeze({
            field_code: "intake.source" as ControlledCode,
            value: intake.content.source,
            source_object_id:
              intake.section_version_id,
            source_object_version_id:
              intake.section_version_id,
          }),
          Object.freeze({
            field_code: "intake.organization_reference" as ControlledCode,
            value:
              intake.content
                .organization_reference,
            source_object_id:
              intake.section_version_id,
            source_object_version_id:
              intake.section_version_id,
          }),
        ]),
    });
  }

  async assertCaseUnchanged(
    context:
      CapaIntakeAdvisoryCaseContext,
  ): Promise<boolean> {
    const capaCase =
      await this.dependencies.repository
        .findCaseById(
          context.organization_id,
          context.capa_case_id,
        );

    return (
      capaCase !== null &&
      capaCase.current_version_id ===
        context.case_version_id &&
      capaCase.record_version ===
        context.record_version &&
      capaCase.status ===
        context.workflow_state
    );
  }
}
