import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  SubmitCapaRootCausePackageIntegrityError,
  submitCapaRootCausePackage,
  type SubmitCapaRootCausePackageDependencies,
} from "../../lib/capa/application/submit-capa-root-cause-package";
import { InMemoryCapaDatabase } from "../../lib/database/in-memory/in-memory-capa-database";
import { constructCapaInvestigationActiveAdoption } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";
import { CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION } from "../../lib/capa/ai/capa-investigation-active-adoption-contract";
import { canonicalJson } from "../../lib/capa/ai/capa-ai-generation-trace";

const ORG = "20000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const NEXT = "40000000-0000-4000-8000-000000000002";
const ALTERNATE_SOURCE = "40000000-0000-4000-8000-000000000003";
const PLAN = "70000000-0000-4000-8000-000000000001";
const PLAN_B = "70000000-0000-4000-8000-000000000009";
const LEDGER = "70000000-0000-4000-8000-000000000002";
const ROOT = "70000000-0000-4000-8000-000000000003";
const RETURN_RESPONSE = "70000000-0000-4000-8000-000000000004";
const AUDIT = "80000000-0000-4000-8000-000000000001";
const RETURN_AUDIT = "80000000-0000-4000-8000-000000000002";
const RETURN_SOURCE = "40000000-0000-4000-8000-000000000008";
const HISTORICAL_ADOPTION = "90000000-0000-4000-8000-000000000001";
const HISTORICAL_OUTPUT = "90000000-0000-4000-8000-000000000002";
const HISTORICAL_REQUEST = "90000000-0000-4000-8000-000000000003";
const HISTORICAL_CORRELATION = "90000000-0000-4000-8000-000000000004";
const HISTORICAL_NEXT = "40000000-0000-4000-8000-000000000006";
const HISTORICAL_RESULT = "40000000-0000-4000-8000-000000000007";
const NOW = "2026-09-01T12:00:00.000Z";
const human = {
  source_type: "human",
  source_reference: null,
  adopted_by_user_id: null,
  adopted_at: null,
};

function plan(status = "completed") {
  return {
    items: [
      {
        item_id: "INV-1",
        investigation_question: "Why?",
        evidence_target: "Record",
        investigation_method: "Review",
        owner_user_id: USER,
        due_date: "2026-09-30",
        sme_user_ids: [],
        dependency_item_ids: [],
        scope_relationship: "Included process",
        status,
        disposition: null,
        disposition_rationale: null,
        draft_provenance: human,
      },
    ],
  };
}
function ledger(status = "verified") {
  return {
    items: [
      {
        item_id: "E-1",
        information_class: "verified_evidence",
        statement: "The record establishes seal wear.",
        evidence_status: status,
        assumption_status: null,
        gap_status: null,
        conflict_status: null,
        provenance: human,
        owner_user_id: null,
        information_date: null,
        source_version: null,
        context: null,
        linked_capa_objects: [],
        supporting_item_ids: [],
        contradictory_item_ids: [],
        conflict_item_ids: [],
        material_to_conclusion: false,
        critical_to_conclusion: false,
        recommended_next_step: null,
        target_date: null,
        human_disposition: {
          user_id: USER,
          disposition_at: NOW,
          rationale: "Reviewed by the investigator.",
        },
      },
    ],
  };
}
function rootCause() {
  return {
    hypotheses: [
      {
        hypothesis_id: "H-1",
        statement: "Seal wear caused the event.",
        status: "confirmed",
        causal_role: "proposed_root_cause",
        rationale: "Supported by the record.",
        responsible_user_id: USER,
        supporting_evidence_item_ids: ["E-1"],
        contradictory_evidence_item_ids: [],
        linked_assumption_item_ids: [],
        linked_gap_item_ids: [],
        linked_conflict_item_ids: [],
        material_to_package: true,
        provenance: human,
      },
    ],
    root_cause_not_confirmed: null,
  };
}
function body(overrides: Record<string, unknown> = {}) {
  return {
    evidence_assumption_ledger: ledger(),
    root_cause_package: rootCause(),
    ...overrides,
  };
}
function returnResponse(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "capa-root-cause-review-return-response-draft-1.0.0",
    response_summary: "The investigator addressed the returned root cause.",
    actions_taken: "The investigator reviewed the remaining evidence.",
    disposition: "addressed",
    supporting_evidence_item_ids: ["E-1"],
    return_transition_audit_event_id: RETURN_AUDIT,
    source_case_version_id: RETURN_SOURCE,
    resulting_case_version_id: SOURCE,
    responded_by: { actor_type: "human", actor_id: USER },
    responded_at: NOW,
    ...overrides,
  };
}
function submissionFingerprint(
  response: Record<string, unknown> | null = null,
) {
  return createHash("sha256")
    .update(canonicalJson({
      fingerprint_version: "submit-capa-root-cause-package-fingerprint-1",
      organization_id: ORG,
      capa_case_id: CASE,
      operation_code: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
      expected_record_version: 4,
      expected_current_version_id: SOURCE,
      evidence_assumption_ledger: ledger(),
      root_cause_package: rootCause(),
      ...(response === null ? {} : { root_cause_review_return_response: response }),
      configuration: {
        workflow_version: "workflow-1",
        evidence_assumption_ledger_schema_version: "capa-evidence-assumption-ledger-1.0.0",
        root_cause_package_schema_version: "capa-root-cause-package-1.0.0",
        investigation_plan_schema_version: "capa-investigation-plan-1.0.0",
        audit_schema_version: "audit-1",
      },
    }), "utf8")
    .digest("hex");
}
function workspace(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "capa-investigation-active-workspace-draft-1.0.0",
    trust: "untrusted_human_draft",
    workflow_state: "S40",
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: SOURCE,
    record_version: 4,
    draft_revision: 1,
    evidence_assumption_ledger: ledger(),
    root_cause_package: rootCause(),
    root_cause_return_response: returnResponse(),
    updated_by_user_id: USER,
    updated_at: NOW,
    ...overrides,
  };
}
function capaCase(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    case_number: "CAPA-000001",
    current_version_id: SOURCE,
    status: "S40",
    record_version: 4,
    owner_user_id: USER,
    confidentiality: "CUSTOMER_CONFIDENTIAL",
    effective_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
    updated_by: { actor_type: "human", actor_id: USER },
    ...overrides,
  };
}
function sourceVersion(
  sectionIds = [PLAN],
  overrides: Record<string, unknown> = {}
) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: SOURCE,
    version_number: 4,
    parent_version_id: "40000000-0000-4000-8000-000000000000",
    change_reason: "G-03",
    status: "S40",
    section_version_ids: sectionIds,
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
    ...overrides,
  };
}
function planSection(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    section_version_id: PLAN,
    section_type: "CAPA.INVESTIGATION_PLAN",
    version_number: 1,
    schema_version: "capa-investigation-plan-1.0.0",
    content: plan(),
    change_reason: "G-03",
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
    ...overrides,
  };
}
function ledgerSection(overrides: Record<string, unknown> = {}) {
  return planSection({
    section_version_id: LEDGER,
    section_type: "CAPA.EVIDENCE_ASSUMPTION_LEDGER",
    schema_version: "capa-evidence-assumption-ledger-1.0.0",
    content: ledger(),
    ...overrides,
  });
}
function activeReturnCycle(overrides: Record<string, unknown> = {}) {
  return {
    status: "active",
    cycle: {
      return_transition_audit_event_id: RETURN_AUDIT,
      source_case_version_id: RETURN_SOURCE,
      resulting_case_version_id: SOURCE,
      returned_by: { actor_type: "human", actor_id: USER },
      returned_at: NOW,
      rationale: "Investigate the remaining uncertainty.",
      source_record_version: 3,
      resulting_record_version: 4,
      ...overrides,
    },
  };
}
function command(
  applicationBody: unknown = body(),
  overrides: Record<string, unknown> = {}
) {
  return {
    authentication: {
      principal: { principal_type: "human", user_id: USER },
      session_id: "session",
      authentication_method: "SUPABASE_SESSION",
      assurance_level: "SINGLE_FACTOR",
      authenticated_at: NOW,
      expires_at: "2026-09-02T12:00:00.000Z",
    },
    tenant: {
      organization_id: ORG,
      access_grant_id: "grant",
      access_path: "ORGANIZATION",
      authorization_policy_version: "policy-1",
      resolved_at: NOW,
      role_assignments: [],
    },
    capa_case_id: CASE,
    expected_record_version: 4,
    expected_current_version_id: SOURCE,
    request_trace: {
      request_id: "50000000-0000-4000-8000-000000000001",
      correlation_id: "60000000-0000-4000-8000-000000000001",
      idempotency_key: "submit-1",
    },
    body: applicationBody,
    ...overrides,
  } as never;
}

function harness(
  options: {
    sections?: unknown[];
    claim?: unknown;
    advanced?: unknown;
    policy?: unknown;
    lookup?: unknown;
    workspace?: unknown;
    return_cycle?: unknown;
    failureAt?:
      | "first_section"
      | "second_section"
      | "case_version"
      | "aggregate"
      | "audit_throw"
      | "audit_conflict";
  } = {}
) {
  const inserts: unknown[] = [];
  const appendEvent = vi.fn(async (..._arguments: unknown[]) => {
    if (options.failureAt === "audit_throw") throw new Error("audit failed");
    if (options.failureAt === "audit_conflict")
      return { status: "conflict", event_id: AUDIT };
    return { status: "appended", event_id: AUDIT };
  });
  const findEventById = vi.fn();
  let sectionInsertCalls = 0;
  const findSectionVersionById = vi.fn(
    async (_o, _c, id) =>
      (options.sections ?? [planSection()]).find(
        (s: any) => s.section_version_id === id
      ) ?? null
  );
  const repository = {
    findCaseById: vi.fn().mockResolvedValue(capaCase()),
    findCaseVersionById: vi
      .fn()
      .mockResolvedValue(
        sourceVersion(
          (options.sections ?? [planSection()]).map(
            (s: any) => s.section_version_id
          )
        )
      ),
    findSectionVersionById,
    insertSectionVersion: vi.fn(async (_t, section) => {
      sectionInsertCalls += 1;
      if (
        (options.failureAt === "first_section" && sectionInsertCalls === 1) ||
        (options.failureAt === "second_section" && sectionInsertCalls === 2)
      )
        throw new Error("section failed");
      inserts.push(section);
    }),
    insertCaseVersion: vi.fn(async (_t, version) => {
      if (options.failureAt === "case_version")
        throw new Error("case version failed");
      inserts.push(version);
    }),
    advanceCurrentVersion: vi.fn(async () => {
      if (options.failureAt === "aggregate") throw new Error("advance failed");
      return options.advanced ?? {
        status: "updated",
        capa_case: capaCase({
          status: "S50",
          record_version: 5,
          current_version_id: NEXT,
        }),
      };
    }),
  };
  const policy = {
    evaluate: vi.fn().mockResolvedValue(
      options.policy ?? {
        decision: "allow",
        reason_code: "AUTHORIZED",
        policy_version: "policy-1",
        evaluated_at: NOW,
        relied_on_role_assignment_ids: ["assignment-1"],
      }
    ),
  };
  let sectionId = 0;
  const deps: SubmitCapaRootCausePackageDependencies = {
    transaction_manager: {
      runInTransaction: vi.fn(async (trace, work) => {
        const savepoint = inserts.length;
        try {
          return await work({
            transaction_id: "tx",
            started_at: NOW,
            request_trace: trace,
          });
        } catch (error) {
          inserts.splice(savepoint);
          throw error;
        }
      }),
    } as never,
    capa_repository: repository as never,
    audit_repository: { appendEvent, findEventById } as never,
    adoption_repository: { findAdoptionById: vi.fn().mockResolvedValue(null) } as never,
    workspace_repository: {
      findDraft: vi.fn().mockResolvedValue(options.workspace ?? null),
    } as never,
    return_cycle_resolver: {
      resolve: vi.fn().mockResolvedValue(
        options.return_cycle ?? { status: "no_active_return_cycle" }
      ),
    } as never,
    workflow_idempotency_repository: {
      findWorkflowOperation: vi.fn().mockResolvedValue(options.lookup ?? null),
      claimWorkflowOperation: vi
        .fn()
        .mockResolvedValue(options.claim ?? { status: "claimed" }),
    } as never,
    authorization_policy: policy as never,
    id_generator: {
      generateCaseVersionId: () => NEXT,
      generateSectionVersionId: () => [LEDGER, ROOT, RETURN_RESPONSE][sectionId++]!,
      generateAuditEventId: () => AUDIT,
    } as never,
    clock: { now: () => new Date(NOW) },
    configuration: {
      workflow_version: "workflow-1",
      audit_schema_version: "audit-1",
      authorization_purpose: "CAPA_WORKFLOW_TRANSITION" as never,
    },
  };
  return { deps, repository, appendEvent, findEventById, inserts, policy };
}

async function statefulHarness(options: { alternateSource?: boolean } = {}) {
  let transactionSequence = 0;
  const database = new InMemoryCapaDatabase({
    generate_transaction_id: () => `transaction-${++transactionSequence}` as never,
    now: () => new Date(NOW),
  });
  await database.runInTransaction(
    {
      request_id: "50000000-0000-4000-8000-000000000001",
      correlation_id: "60000000-0000-4000-8000-000000000001",
      idempotency_key: "seed",
    } as never,
    async (transaction) => {
    await database.insertCase(transaction, capaCase() as never);
    await database.insertSectionVersion(transaction, planSection() as never);
    await database.insertCaseVersion(transaction, sourceVersion() as never);
    if (options.alternateSource)
      await database.insertCaseVersion(
        transaction,
        sourceVersion([PLAN], {
          case_version_id: ALTERNATE_SOURCE,
          version_number: 3,
        }) as never
      );
    }
  );
  const policy = {
    evaluate: vi.fn().mockResolvedValue({
      decision: "allow",
      reason_code: "AUTHORIZED",
      policy_version: "policy-1",
      evaluated_at: NOW,
      relied_on_role_assignment_ids: ["assignment-1"],
    }),
  };
  let failAudit = false;
  let sectionSequence = 0;
  const auditRepository = {
    findEventById: (...args: unknown[]) =>
      database.findEventById(...(args as [never, never])),
    appendEvent: async (transaction: unknown, event: unknown) => {
      if (failAudit) throw new Error("injected late audit failure");
      return database.appendEvent(transaction as never, event as never);
    },
  };
  const deps: SubmitCapaRootCausePackageDependencies = {
    transaction_manager: database,
    capa_repository: database,
    audit_repository: auditRepository as never,
    adoption_repository: database,
    workspace_repository: database,
    return_cycle_resolver: {
      resolve: vi.fn().mockResolvedValue({ status: "no_active_return_cycle" }),
    } as never,
    workflow_idempotency_repository: database,
    authorization_policy: policy as never,
    id_generator: {
      generateCaseVersionId: () => NEXT,
      generateSectionVersionId: () => [LEDGER, ROOT][sectionSequence++ % 2]!,
      generateAuditEventId: () => AUDIT,
    } as never,
    clock: { now: () => new Date(NOW) },
    configuration: {
      workflow_version: "workflow-1",
      audit_schema_version: "audit-1",
      authorization_purpose: "CAPA_WORKFLOW_TRANSITION" as never,
    },
  };
  return {
    database,
    deps,
    setAuditFailure(value: boolean) {
      failAudit = value;
    },
  };
}

describe("S40 root-cause package submission", () => {
  it("accepts a human adoption from an authoritative historical S40 ancestor", async () => {
    const test = harness();
    const adoptedContent = {
      gap: "The configuration record is missing.",
      why_it_matters: "The missing record can affect causal analysis.",
      recommended_next_step: "Review the configuration archive.",
    };
    const historicalLedger = {
      items: [ledger().items[0], {
        ...ledger().items[0],
        item_id: "AI-1",
        information_class: "missing_information",
        statement: adoptedContent.gap,
        evidence_status: null,
        gap_status: "open",
        context: adoptedContent.why_it_matters,
        recommended_next_step: adoptedContent.recommended_next_step,
        critical_to_conclusion: false,
        human_disposition: null,
        provenance: { source_type: "ai_proposal", source_reference: HISTORICAL_ADOPTION, adopted_by_user_id: USER, adopted_at: NOW },
      }],
    };
    const historicalBody = { evidence_assumption_ledger: historicalLedger, root_cause_package: rootCause() };
    const historicalAdoption = constructCapaInvestigationActiveAdoption({
      adoption_id: HISTORICAL_ADOPTION as never,
      organization_id: ORG as never,
      capa_case_id: CASE as never,
      case_version_id: SOURCE as never,
      record_version: 4,
      output_id: HISTORICAL_OUTPUT as never,
      proposal_key: "P1",
      proposal_category: "evidence_gap",
      adopted_item: { proposal_key: "P1", adopted_content: adoptedContent },
      resolved_reference_bindings: [],
      reference_manifest_schema_version: "capa-investigation-active-reference-manifest-1.0.0",
      reference_manifest_fingerprint_algorithm: "sha256-canonical-json-v1",
      reference_manifest_sha256: "a".repeat(64),
      adopted_at: NOW as never,
      adopted_by: { actor_type: "human", actor_id: USER },
      adoption_policy_version: CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION,
      request_id: HISTORICAL_REQUEST as never,
      correlation_id: HISTORICAL_CORRELATION as never,
      idempotency_key: "historical-adoption" as never,
      workflow_mutated: false,
      controlled_record_mutated: false,
      gate_approved: false,
    });
    const current = sourceVersion([PLAN], { case_version_id: HISTORICAL_NEXT, version_number: 5, parent_version_id: SOURCE });
    test.repository.findCaseById.mockResolvedValue(capaCase({ current_version_id: HISTORICAL_NEXT, record_version: 5 }));
    test.repository.findCaseVersionById.mockImplementation(async (_organizationId, _caseId, versionId) => versionId === SOURCE ? sourceVersion() : versionId === HISTORICAL_NEXT ? current : null);
    test.repository.advanceCurrentVersion.mockResolvedValue({ status: "updated", capa_case: capaCase({ status: "S50", record_version: 6, current_version_id: HISTORICAL_RESULT }) });
    (test.deps as unknown as { adoption_repository: unknown }).adoption_repository = { findAdoptionById: vi.fn().mockResolvedValue({ adoption: historicalAdoption }) };
    (test.deps.id_generator as unknown as { generateCaseVersionId: () => string }).generateCaseVersionId = () => HISTORICAL_RESULT;
    await expect(submitCapaRootCausePackage(test.deps, command(historicalBody, { expected_record_version: 5, expected_current_version_id: HISTORICAL_NEXT }))).resolves.toMatchObject({ status: "submitted", capa_case: { status: "S50", record_version: 6, current_version_id: HISTORICAL_RESULT } });
  });

  it("persists two sections, one S50 version, exact +1 aggregate, and one transition audit", async () => {
    const test = harness();
    const result = await submitCapaRootCausePackage(test.deps, command());
    expect(result).toMatchObject({
      status: "submitted",
      capa_case: { status: "S50", record_version: 5 },
    });
    expect(test.repository.insertSectionVersion).toHaveBeenCalledTimes(2);
    expect(test.repository.insertCaseVersion).toHaveBeenCalledOnce();
    expect(test.repository.insertCaseVersion.mock.calls[0]![1]).toMatchObject({
      status: "S50",
      parent_version_id: SOURCE,
      section_version_ids: [PLAN, LEDGER, ROOT],
    });
    expect(test.appendEvent).toHaveBeenCalledOnce();
    expect(test.appendEvent.mock.calls[0]![1]).toMatchObject({
      event_type: "EVT-STATE-TRANSITION",
      action: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
      metadata: {
        from_state: "S40",
        to_state: "S50",
        transition_event: "Submit root cause for review",
        investigation_plan_section_version_id: PLAN,
        evidence_assumption_ledger_section_version_id: LEDGER,
        root_cause_package_section_version_id: ROOT,
        required_permission: "capa.case.submit",
      },
    });
    expect(test.policy.evaluate.mock.calls[0]![0]).toMatchObject({
      operation: "submit_for_review",
      resource: { workflow_state: "S40" },
    });
  });

  it("preserves first-time S40 to S50 behavior when no return cycle is active", async () => {
    const test = harness();
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toMatchObject({ status: "submitted" });
    expect(test.repository.insertSectionVersion).toHaveBeenCalledTimes(2);
  });

  it("requires a durable response for an active return cycle without writing", async () => {
    const test = harness({
      sections: [planSection(), ledgerSection()],
      return_cycle: activeReturnCycle(),
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toEqual({
      status: "validation_failed",
      reason_code: "ROOT_CAUSE_REVIEW_RETURN_RESPONSE_REQUIRED",
    });
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
    expect(test.repository.insertCaseVersion).not.toHaveBeenCalled();
    expect(test.appendEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid durable response", async () => {
    const test = harness({
      sections: [planSection(), ledgerSection()],
      return_cycle: activeReturnCycle(),
      workspace: workspace({
        root_cause_return_response: returnResponse({ disposition: "invalid" }),
      }),
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toEqual({
      status: "validation_failed",
      reason_code: "ROOT_CAUSE_REVIEW_RETURN_RESPONSE_INVALID",
    });
  });

  it("rejects a response bound to a different return cycle", async () => {
    const test = harness({
      sections: [planSection(), ledgerSection()],
      return_cycle: activeReturnCycle(),
      workspace: workspace({
        root_cause_return_response: returnResponse({
          resulting_case_version_id: RETURN_SOURCE,
        }),
      }),
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toEqual({
      status: "validation_failed",
      reason_code: "ROOT_CAUSE_REVIEW_RETURN_RESPONSE_CYCLE_CONFLICT",
    });
  });

  it("does not reuse a prior-cycle response for a later return cycle", async () => {
    const test = harness({
      sections: [planSection(), ledgerSection()],
      return_cycle: activeReturnCycle({
        return_transition_audit_event_id: "80000000-0000-4000-8000-000000000009",
        source_case_version_id: "40000000-0000-4000-8000-000000000009",
      }),
      workspace: workspace(),
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toEqual({
      status: "validation_failed",
      reason_code: "ROOT_CAUSE_REVIEW_RETURN_RESPONSE_CYCLE_CONFLICT",
    });
  });

  it("rejects response evidence absent from the authoritative S40 ledger", async () => {
    const test = harness({
      sections: [planSection(), ledgerSection()],
      return_cycle: activeReturnCycle(),
      workspace: workspace({
        root_cause_return_response: returnResponse({
          supporting_evidence_item_ids: ["E-NOT-IN-LEDGER"],
        }),
      }),
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toEqual({
      status: "validation_failed",
      reason_code: "RETURN_RESPONSE_EVIDENCE_REFERENCE_INVALID",
    });
  });

  it("materializes the exact durable response and preserves its author", async () => {
    const test = harness({
      sections: [planSection(), ledgerSection()],
      return_cycle: activeReturnCycle(),
      workspace: workspace(),
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toMatchObject({
      status: "submitted",
      capa_case: { status: "S50", record_version: 5 },
      root_cause_review_return_response_section_version: {
        section_version_id: RETURN_RESPONSE,
        section_type: "CAPA.ROOT_CAUSE_REVIEW_RETURN_RESPONSE",
        schema_version: "capa-root-cause-review-return-response-1.0.0",
        content: {
          response_summary: "The investigator addressed the returned root cause.",
          actions_taken: "The investigator reviewed the remaining evidence.",
          disposition: "addressed",
          supporting_evidence_item_ids: ["E-1"],
          return_transition_audit_event_id: RETURN_AUDIT,
          source_case_version_id: RETURN_SOURCE,
          resulting_case_version_id: SOURCE,
          responded_by: { actor_type: "human", actor_id: USER },
          responded_at: NOW,
        },
      },
    });
    expect(test.repository.insertSectionVersion).toHaveBeenCalledTimes(3);
    expect(test.repository.insertCaseVersion.mock.calls[0]![1].section_version_ids).toEqual([
      PLAN,
      LEDGER,
      ROOT,
      RETURN_RESPONSE,
    ]);
    expect(
      (test.appendEvent.mock.calls[0]![1] as { metadata: Record<string, unknown> })
        .metadata,
    ).toMatchObject({
      root_cause_review_return_response_section_version_id: RETURN_RESPONSE,
    });
  });

  it("replaces prior ledger/package versions while preserving plan and unrelated sections", async () => {
    const oldLedger = {
      ...planSection({
        section_version_id: "71000000-0000-4000-8000-000000000001",
        section_type: "CAPA.EVIDENCE_ASSUMPTION_LEDGER",
        schema_version: "capa-evidence-assumption-ledger-1.0.0",
        version_number: 2,
        content: ledger(),
      }),
    };
    const oldRoot = {
      ...planSection({
        section_version_id: "72000000-0000-4000-8000-000000000001",
        section_type: "CAPA.ROOT_CAUSE_PACKAGE",
        schema_version: "capa-root-cause-package-1.0.0",
        version_number: 3,
        content: rootCause(),
      }),
    };
    const unrelated = planSection({
      section_version_id: "73000000-0000-4000-8000-000000000001",
      section_type: "CAPA.SCOPE",
    });
    const test = harness({
      sections: [planSection(), oldLedger, unrelated, oldRoot],
    });
    await submitCapaRootCausePackage(test.deps, command());
    expect(
      test.repository.insertSectionVersion.mock.calls[0]![1]
    ).toMatchObject({
      version_number: 3,
      parent_version_id: oldLedger.section_version_id,
    });
    expect(
      test.repository.insertSectionVersion.mock.calls[1]![1]
    ).toMatchObject({
      version_number: 4,
      parent_version_id: oldRoot.section_version_id,
    });
    expect(
      test.repository.insertCaseVersion.mock.calls[0]![1].section_version_ids
    ).toEqual([PLAN, LEDGER, unrelated.section_version_id, ROOT]);
  });

  it.each(["ledger", "root"] as const)(
    "replaces an existing %s while starting the other controlled section at version 1",
    async (existingType) => {
      const priorId =
        existingType === "ledger"
          ? "71000000-0000-4000-8000-000000000001"
          : "72000000-0000-4000-8000-000000000001";
      const prior = planSection({
        section_version_id: priorId,
        section_type:
          existingType === "ledger"
            ? "CAPA.EVIDENCE_ASSUMPTION_LEDGER"
            : "CAPA.ROOT_CAUSE_PACKAGE",
        schema_version:
          existingType === "ledger"
            ? "capa-evidence-assumption-ledger-1.0.0"
            : "capa-root-cause-package-1.0.0",
        version_number: 3,
        content: existingType === "ledger" ? ledger() : rootCause(),
      });
      const unrelated = planSection({
        section_version_id: "73000000-0000-4000-8000-000000000001",
        section_type: "CAPA.SCOPE",
      });
      const test = harness({ sections: [planSection(), prior, unrelated] });
      await submitCapaRootCausePackage(test.deps, command());
      const persistedLedger = test.repository.insertSectionVersion.mock.calls[0]![1];
      const persistedRoot = test.repository.insertSectionVersion.mock.calls[1]![1];
      expect(persistedLedger).toMatchObject(
        existingType === "ledger"
          ? { version_number: 4, parent_version_id: priorId }
          : { version_number: 1 }
      );
      expect(persistedRoot).toMatchObject(
        existingType === "root"
          ? { version_number: 4, parent_version_id: priorId }
          : { version_number: 1 }
      );
      if (existingType === "ledger")
        expect(persistedRoot).not.toHaveProperty("parent_version_id");
      else expect(persistedLedger).not.toHaveProperty("parent_version_id");
      const ids = test.repository.insertCaseVersion.mock.calls[0]![1]
        .section_version_ids;
      expect(ids).toEqual([PLAN, existingType === "ledger" ? LEDGER : ROOT, unrelated.section_version_id, ...(existingType === "ledger" ? [ROOT] : [LEDGER])]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  );

  it("rejects malformed ledger and package before persistence", async () => {
    for (const invalid of [
      body({ evidence_assumption_ledger: {} }),
      body({ root_cause_package: {} }),
    ]) {
      const test = harness();
      expect(
        (await submitCapaRootCausePackage(test.deps, command(invalid))).status
      ).toBe("validation_failed");
      expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
    }
  });

  it("uses the stored plan and preserves readiness reason/canonical codes", async () => {
    const test = harness({
      sections: [planSection({ content: plan("in_progress") })],
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toEqual({
      status: "submission_blocked",
      reason_codes: ["OPEN_INVESTIGATION_PLAN_ITEM"],
      canonical_blocker_codes: [],
    });
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
  });

  it("preserves the canonical B-02, B-03, and B-04 readiness mappings", async () => {
    const base = ledger().items[0]!;
    const blockedLedger = {
      items: [
        base,
        { ...base, item_id: "E-2" },
        {
          ...base,
          item_id: "G-1",
          information_class: "missing_information",
          evidence_status: null,
          gap_status: "open",
          critical_to_conclusion: true,
          human_disposition: null,
        },
        {
          ...base,
          item_id: "C-1",
          information_class: "conflicting_information",
          evidence_status: null,
          conflict_status: "open",
          conflict_item_ids: ["E-1", "E-2"],
          material_to_conclusion: true,
          human_disposition: null,
        },
        {
          ...base,
          item_id: "A-1",
          information_class: "assumption",
          evidence_status: null,
          assumption_status: "open",
          material_to_conclusion: true,
          human_disposition: null,
        },
      ],
    };
    const test = harness();
    await expect(
      submitCapaRootCausePackage(
        test.deps,
        command(body({ evidence_assumption_ledger: blockedLedger }))
      )
    ).resolves.toMatchObject({
      status: "submission_blocked",
      reason_codes: [
        "UNRESOLVED_CRITICAL_EVIDENCE_GAP",
        "UNRESOLVED_MATERIAL_CONTRADICTION",
        "OPEN_MATERIAL_ASSUMPTION",
      ],
      canonical_blocker_codes: ["B-02", "B-03", "B-04"],
    });
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
  });

  it("preserves B-06 when invalid evidence is relied upon", async () => {
    const test = harness();
    await expect(
      submitCapaRootCausePackage(
        test.deps,
        command(
          body({
            evidence_assumption_ledger: ledger("rejected"),
          })
        )
      )
    ).resolves.toMatchObject({
      status: "submission_blocked",
      reason_codes: ["INVALID_EVIDENCE_RELIED_UPON"],
      canonical_blocker_codes: ["B-06"],
    });
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
  });

  it.each([
    [[], "missing"],
    [
      [
        planSection(),
        planSection({
          section_version_id: "70000000-0000-4000-8000-000000000009",
        }),
      ],
      "duplicate",
    ],
    [
      [
        planSection({
          organization_id: "20000000-0000-4000-8000-000000000009",
        }),
      ],
      "wrong tenant",
    ],
    [
      [planSection({ capa_case_id: "30000000-0000-4000-8000-000000000009" })],
      "wrong case",
    ],
    [[planSection({ schema_version: "wrong" })], "wrong schema"],
    [[planSection({ content: {} })], "malformed"],
  ])("fails closed for %s authoritative plan", async (sections) => {
    const test = harness({ sections: sections as unknown[] });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).rejects.toBeInstanceOf(SubmitCapaRootCausePackageIntegrityError);
  });

  it.each([
    [
      [planSection(), planSection()],
      "duplicate source section identity",
    ],
    [
      [
        planSection(),
        planSection({
          section_version_id: "71000000-0000-4000-8000-000000000001",
          section_type: "CAPA.EVIDENCE_ASSUMPTION_LEDGER",
          schema_version: "wrong",
        }),
      ],
      "invalid prior ledger metadata",
    ],
    [
      [
        planSection(),
        planSection({
          section_version_id: "72000000-0000-4000-8000-000000000001",
          section_type: "CAPA.ROOT_CAUSE_PACKAGE",
          schema_version: "wrong",
        }),
      ],
      "invalid prior package metadata",
    ],
  ])("rejects %s", async (sections) => {
    const test = harness({ sections });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).rejects.toBeInstanceOf(SubmitCapaRootCausePackageIntegrityError);
  });

  it("requires a human and maps policy denial without persistence", async () => {
    const service = harness();
    await expect(
      submitCapaRootCausePackage(
        service.deps,
        command(body(), {
          authentication: {
            principal: {
              principal_type: "service",
              service_identity_id: "svc",
            },
            session_id: "session",
            authentication_method: "SUPABASE_SESSION",
            assurance_level: "SINGLE_FACTOR",
            authenticated_at: NOW,
            expires_at: "2026-09-02T12:00:00.000Z",
          },
        })
      )
    ).resolves.toMatchObject({ status: "authorization_denied" });
    const denied = harness({
      policy: {
        decision: "deny",
        reason_code: "REQUIRED_PERMISSION_NOT_GRANTED",
        policy_version: "policy-1",
        evaluated_at: NOW,
      },
    });
    await expect(
      submitCapaRootCausePackage(denied.deps, command())
    ).resolves.toMatchObject({ status: "authorization_denied" });
  });

  it.each([
    [
      capaCase({ status: "S30" }),
      sourceVersion([PLAN], { status: "S30" }),
      "workflow_conflict",
    ],
    [capaCase({ record_version: 5 }), sourceVersion(), "concurrency_conflict"],
    [
      capaCase({ current_version_id: "40000000-0000-4000-8000-000000000009" }),
      sourceVersion(),
      "concurrency_conflict",
    ],
  ])(
    "fails closed for workflow/concurrency mismatch",
    async (caseValue, versionValue, expected) => {
      const test = harness();
      test.repository.findCaseById.mockResolvedValue(caseValue as never);
      test.repository.findCaseVersionById.mockResolvedValue(
        versionValue as never
      );
      expect(
        (await submitCapaRootCausePackage(test.deps, command())).status
      ).toBe(expected);
    }
  );

  it("returns idempotency conflict for a mismatched claim", async () => {
    const test = harness({ claim: { status: "conflict" } });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toEqual({
      status: "idempotency_conflict",
      reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    });
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
  });

  it("uses the stateful idempotency repository to reject a changed submission body", async () => {
    const test = await statefulHarness();
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toMatchObject({ status: "submitted" });
    const changedLedger = ledger();
    const changedBody = {
      ...changedLedger,
      items: changedLedger.items.map((item) => ({
        ...item,
        statement: "A materially different controlled evidence statement.",
      })),
    };
    await expect(
      submitCapaRootCausePackage(
        test.deps,
        command(body({ evidence_assumption_ledger: changedBody }))
      )
    ).resolves.toEqual({
      status: "idempotency_conflict",
      reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    });
  });

  it.each([
    ["record version", { expected_record_version: 5 }],
    [
      "current version",
      { expected_current_version_id: ALTERNATE_SOURCE },
    ],
  ])("binds the stateful fingerprint to a different %s expectation", async (_label, overrides) => {
    const test = await statefulHarness({ alternateSource: true });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      submitCapaRootCausePackage(
        test.deps,
        command(body(), overrides)
      )
    ).resolves.toEqual({
      status: "idempotency_conflict",
      reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    });
  });

  it("rolls back a late audit failure in the shared in-memory transaction and permits retry", async () => {
    const test = await statefulHarness();
    test.setAuditFailure(true);
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).rejects.toThrow("injected late audit failure");
    await expect(test.database.findCaseById(ORG as never, CASE as never)).resolves.toMatchObject({
      status: "S40",
      record_version: 4,
      current_version_id: SOURCE,
    });
    await expect(
      test.database.findCaseVersionById(ORG as never, CASE as never, NEXT as never)
    ).resolves.toBeNull();
    await expect(
      test.database.findSectionVersionById(ORG as never, CASE as never, LEDGER as never)
    ).resolves.toBeNull();
    await expect(
      test.database.findSectionVersionById(ORG as never, CASE as never, ROOT as never)
    ).resolves.toBeNull();
    await expect(
      test.database.findEventById(ORG as never, AUDIT as never)
    ).resolves.toBeNull();
    test.setAuditFailure(false);
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toMatchObject({ status: "submitted" });
  });

  it("replays an exact persisted S50 result without duplicate writes", async () => {
    const record = {
      organization_id: ORG,
      idempotency_key: "submit-1",
      operation_code: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
      request_fingerprint: submissionFingerprint(),
      capa_case_id: CASE,
      source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT,
      audit_event_id: AUDIT,
    };
    const test = harness({
      claim: { status: "already_claimed", record },
      lookup: record,
      return_cycle: activeReturnCycle({
        return_transition_audit_event_id: "90000000-0000-4000-8000-000000000009",
      }),
      workspace: { root_cause_return_response: returnResponse() },
    });
    const resultSections = [
      planSection(),
      planSection({
        section_version_id: LEDGER,
        section_type: "CAPA.EVIDENCE_ASSUMPTION_LEDGER",
        schema_version: "capa-evidence-assumption-ledger-1.0.0",
        content: ledger(),
      }),
      planSection({
        section_version_id: ROOT,
        section_type: "CAPA.ROOT_CAUSE_PACKAGE",
        schema_version: "capa-root-cause-package-1.0.0",
        content: rootCause(),
      }),
    ];
    test.repository.findCaseById.mockResolvedValue(
      capaCase({ status: "S50", record_version: 5, current_version_id: NEXT })
    );
    test.repository.findCaseVersionById.mockImplementation(
      async (_o, _c, id) =>
        id === SOURCE
          ? sourceVersion()
          : {
              ...sourceVersion(resultSections.map((section) => section.section_version_id)),
              case_version_id: NEXT,
              parent_version_id: SOURCE,
              status: "S50",
              version_number: 5,
            }
    );
    test.repository.findSectionVersionById.mockImplementation(
      async (_o, _c, id) =>
        resultSections.find((section) => section.section_version_id === id) ??
        null
    );
    test.findEventById.mockResolvedValue({
        event_id: AUDIT,
        organization_id: ORG,
        event_type: "EVT-STATE-TRANSITION",
        aggregate_type: "CAPA_CASE",
        aggregate_id: CASE,
        aggregate_version: 5,
        action: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
        metadata: {
          transition_event: "Submit root cause for review",
          from_state: "S40",
          to_state: "S50",
          source_case_version_id: SOURCE,
          resulting_case_version_id: NEXT,
          investigation_plan_section_version_id: PLAN,
          evidence_assumption_ledger_section_version_id: LEDGER,
          root_cause_package_section_version_id: ROOT,
        },
        target: { object_version_id: NEXT },
      });
    const resolveReturnCycle = vi.spyOn(
      test.deps.return_cycle_resolver,
      "resolve",
    ).mockImplementation(async () => {
      throw new Error("historical replay must not resolve the current cycle");
    });
    const findWorkspaceDraft = vi.spyOn(
      test.deps.workspace_repository,
      "findDraft",
    ).mockImplementation(async () => {
      throw new Error("historical replay must not read the current workspace");
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).resolves.toMatchObject({ status: "already_submitted" });
    expect(resolveReturnCycle).not.toHaveBeenCalled();
    expect(findWorkspaceDraft).not.toHaveBeenCalled();
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
    expect(test.repository.insertCaseVersion).not.toHaveBeenCalled();
    expect(test.appendEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["wrong schema", { schema_version: "wrong" }],
    ["wrong cycle", { content: { ...returnResponse(), schema_version: "capa-root-cause-review-return-response-1.0.0", resulting_case_version_id: RETURN_SOURCE } }],
    ["wrong attribution", { content: { ...returnResponse(), schema_version: "capa-root-cause-review-return-response-1.0.0", responded_by: { actor_type: "human", actor_id: "10000000-0000-4000-8000-000000000009" } } }],
    ["wrong canonical content", { content: { ...returnResponse(), schema_version: "capa-root-cause-review-return-response-1.0.0", response_summary: "Tampered response." } }],
  ] as const)("fails closed when persisted response is %s", async (_label, tamper) => {
    const record = {
      organization_id: ORG,
      idempotency_key: "submit-1",
      operation_code: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
      request_fingerprint: submissionFingerprint({ ...returnResponse(), schema_version: "capa-root-cause-review-return-response-1.0.0" }),
      capa_case_id: CASE,
      source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT,
      audit_event_id: AUDIT,
    };
    const test = harness({
      sections: [planSection(), ledgerSection()],
      claim: { status: "already_claimed", record },
      lookup: record,
      return_cycle: activeReturnCycle(),
      workspace: workspace(),
    });
    const responseSection = planSection({
      section_version_id: RETURN_RESPONSE,
      section_type: "CAPA.ROOT_CAUSE_REVIEW_RETURN_RESPONSE",
      schema_version: "capa-root-cause-review-return-response-1.0.0",
      content: { ...returnResponse(), schema_version: "capa-root-cause-review-return-response-1.0.0" },
      ...tamper,
    });
    const resultSections = [
      planSection(),
      ledgerSection(),
      planSection({ section_version_id: ROOT, section_type: "CAPA.ROOT_CAUSE_PACKAGE", schema_version: "capa-root-cause-package-1.0.0", content: rootCause() }),
      ...(tamper === null ? [] : [responseSection]),
    ];
    test.repository.findCaseById.mockResolvedValue(capaCase({ status: "S50", record_version: 5, current_version_id: NEXT }));
    test.repository.findCaseVersionById.mockImplementation(async (_o, _c, id) => id === SOURCE ? sourceVersion([PLAN, LEDGER]) : { ...sourceVersion(resultSections.map((section) => section.section_version_id)), case_version_id: NEXT, parent_version_id: SOURCE, status: "S50", version_number: 5 });
    test.repository.findSectionVersionById.mockImplementation(async (_o, _c, id) => resultSections.find((section) => section.section_version_id === id) ?? null);
    test.findEventById.mockResolvedValue({ event_id: AUDIT, organization_id: ORG, event_type: "EVT-STATE-TRANSITION", aggregate_type: "CAPA_CASE", aggregate_id: CASE, aggregate_version: 5, action: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE", metadata: { transition_event: "Submit root cause for review", from_state: "S40", to_state: "S50", source_case_version_id: SOURCE, resulting_case_version_id: NEXT, investigation_plan_section_version_id: PLAN, evidence_assumption_ledger_section_version_id: LEDGER, root_cause_package_section_version_id: ROOT, root_cause_review_return_response_section_version_id: RETURN_RESPONSE }, target: { object_version_id: NEXT } });
    if (tamper === null || "schema_version" in tamper) {
      await expect(submitCapaRootCausePackage(test.deps, command())).rejects.toBeInstanceOf(SubmitCapaRootCausePackageIntegrityError);
    } else {
      await expect(submitCapaRootCausePackage(test.deps, command())).resolves.toEqual({
        status: "idempotency_conflict",
        reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      });
    }
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
  });

  it("rejects replay when the valid S50 and audit plan differs from the source S40 plan", async () => {
    const record = {
      organization_id: ORG,
      idempotency_key: "submit-1",
      operation_code: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
      request_fingerprint: submissionFingerprint(),
      capa_case_id: CASE,
      source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT,
      audit_event_id: AUDIT,
    };
    const sourcePlan = planSection();
    const resultPlan = planSection({ section_version_id: PLAN_B });
    const resultLedger = planSection({
      section_version_id: LEDGER,
      section_type: "CAPA.EVIDENCE_ASSUMPTION_LEDGER",
      schema_version: "capa-evidence-assumption-ledger-1.0.0",
      content: ledger(),
    });
    const resultRoot = planSection({
      section_version_id: ROOT,
      section_type: "CAPA.ROOT_CAUSE_PACKAGE",
      schema_version: "capa-root-cause-package-1.0.0",
      content: rootCause(),
    });
    const test = harness({
      sections: [sourcePlan],
      claim: { status: "already_claimed", record },
      lookup: record,
    });
    test.repository.findCaseById.mockResolvedValue(
      capaCase({ status: "S50", record_version: 5, current_version_id: NEXT })
    );
    test.repository.findCaseVersionById.mockImplementation(async (_o, _c, id) =>
      id === SOURCE
        ? sourceVersion()
        : {
            ...sourceVersion([PLAN_B, LEDGER, ROOT]),
            case_version_id: NEXT,
            parent_version_id: SOURCE,
            status: "S50",
            version_number: 5,
          }
    );
    test.repository.findSectionVersionById.mockImplementation(
      async (_o, _c, id) =>
        [sourcePlan, resultPlan, resultLedger, resultRoot].find(
          (section) => section.section_version_id === id
        ) ?? null
    );
    test.findEventById.mockResolvedValue({
      event_id: AUDIT,
      organization_id: ORG,
      event_type: "EVT-STATE-TRANSITION",
      aggregate_type: "CAPA_CASE",
      aggregate_id: CASE,
      aggregate_version: 5,
      action: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
      metadata: {
        transition_event: "Submit root cause for review",
        from_state: "S40",
        to_state: "S50",
        source_case_version_id: SOURCE,
        resulting_case_version_id: NEXT,
        investigation_plan_section_version_id: PLAN_B,
        evidence_assumption_ledger_section_version_id: LEDGER,
        root_cause_package_section_version_id: ROOT,
      },
      target: { object_version_id: NEXT },
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).rejects.toBeInstanceOf(SubmitCapaRootCausePackageIntegrityError);
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
    expect(test.repository.insertCaseVersion).not.toHaveBeenCalled();
    expect(test.appendEvent).not.toHaveBeenCalled();
  });

  it.each([
    [[], "missing"],
    [
      [planSection(), planSection({ section_version_id: PLAN_B })],
      "duplicate",
    ],
    [[planSection({ schema_version: "wrong" })], "wrong schema"],
    [
      [planSection({ organization_id: "20000000-0000-4000-8000-000000000009" })],
      "wrong organization",
    ],
    [
      [planSection({ capa_case_id: "30000000-0000-4000-8000-000000000009" })],
      "wrong case",
    ],
  ])("rejects replay with a %s source S40 plan", async (sections) => {
    const record = {
      organization_id: ORG,
      idempotency_key: "submit-1",
      operation_code: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
      request_fingerprint: submissionFingerprint(),
      capa_case_id: CASE,
      source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT,
      audit_event_id: AUDIT,
    };
    const test = harness({
      sections: sections as unknown[],
      claim: { status: "already_claimed", record },
      lookup: record,
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).rejects.toBeInstanceOf(SubmitCapaRootCausePackageIntegrityError);
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
  });

  it("fails closed when replay metadata is corrupted", async () => {
    const record = {
      organization_id: ORG,
      idempotency_key: "submit-1",
      operation_code: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE",
      request_fingerprint: submissionFingerprint(),
      capa_case_id: CASE,
      source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT,
      audit_event_id: AUDIT,
    };
    const test = harness({ claim: { status: "already_claimed", record }, lookup: record });
    test.repository.findCaseById.mockResolvedValue(
      capaCase({ status: "S50", record_version: 5, current_version_id: NEXT })
    );
    test.repository.findCaseVersionById.mockImplementation(async (_o, _c, id) =>
      id === SOURCE
        ? sourceVersion()
        : {
            ...sourceVersion([PLAN, LEDGER, ROOT]),
            case_version_id: NEXT,
            parent_version_id: SOURCE,
            status: "S50",
            version_number: 5,
          }
    );
    test.repository.findSectionVersionById.mockImplementation(
      async (_o, _c, id) =>
        id === PLAN
          ? planSection()
          : id === LEDGER
            ? planSection({
                section_version_id: LEDGER,
                section_type: "CAPA.EVIDENCE_ASSUMPTION_LEDGER",
                schema_version: "capa-evidence-assumption-ledger-1.0.0",
                content: ledger(),
              })
            : planSection({
                section_version_id: ROOT,
                section_type: "CAPA.ROOT_CAUSE_PACKAGE",
                schema_version: "capa-root-cause-package-1.0.0",
                content: rootCause(),
              })
    );
    test.findEventById.mockResolvedValue({
      event_id: AUDIT,
      organization_id: ORG,
      event_type: "EVT-STATE-TRANSITION",
      aggregate_type: "CAPA_CASE",
      aggregate_id: CASE,
      aggregate_version: 5,
      action: "WRONG_ACTION",
      metadata: {},
      target: { object_version_id: NEXT },
    });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).rejects.toBeInstanceOf(SubmitCapaRootCausePackageIntegrityError);
    expect(test.repository.insertSectionVersion).not.toHaveBeenCalled();
  });

  it.each([
    "first_section",
    "second_section",
    "case_version",
    "aggregate",
    "audit_throw",
    "audit_conflict",
  ] as const)("rolls back the controlled transaction when %s fails", async (failureAt) => {
    const test = harness({ failureAt });
    await expect(
      submitCapaRootCausePackage(test.deps, command())
    ).rejects.toThrow();
    expect(test.inserts).toEqual([]);
  });

  it("exposes no override and never requests root-cause approval or step-up", async () => {
    const test = harness();
    await submitCapaRootCausePackage(test.deps, command());
    expect(submitCapaRootCausePackage).toHaveLength(2);
    expect(test.policy.evaluate.mock.calls[0]![0].operation).toBe(
      "submit_for_review"
    );
    expect(JSON.stringify(test.policy.evaluate.mock.calls[0]![0])).not.toMatch(
      /approve_root_cause|MFA|TOTP/
    );
  });
});
