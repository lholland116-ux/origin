import { describe, expect, it, vi } from "vitest";
import type { ExecutionAuthorizationInput } from "@/lib/agent-runtime/capability-executor";
import { createExecutionAuthorizer, type DurableExecutionAssociation, type ExecutionAuthorizerDependencies } from "@/lib/agent-runtime/execution-authorizer";
import { createLvtChatExecutionRuntime } from "@/lib/agent-runtime/execution-runtime";

const USER = "a1000000-0000-4000-8000-000000000001";
const OTHER_USER = "a1000000-0000-4000-8000-000000000002";
const CONVERSATION = "b1000000-0000-4000-8000-000000000001";
const REQUEST = "c1000000-0000-4000-8000-000000000001";
const USER_MESSAGE = "c1000000-0000-4000-8000-000000000002";
const ASSISTANT_MESSAGE = "c1000000-0000-4000-8000-000000000003";
const FILE = "d1000000-0000-4000-8000-000000000001";
const UPLOADED_IMAGE = "d1000000-0000-4000-8000-000000000002";
const GENERATED_IMAGE = "d1000000-0000-4000-8000-000000000003";
const ARTIFACT = "d1000000-0000-4000-8000-000000000004";
const RUN = "e1000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "f1000000-0000-4000-8000-000000000001";
const ACCEPTANCE_FINGERPRINT = "a".repeat(64);
const PLAN_FINGERPRINT = "b".repeat(64);

function generatedImage(conversationId = CONVERSATION, userMessageId = USER_MESSAGE, assistantMessageId = ASSISTANT_MESSAGE) {
  return {
    kind: "generated_image",
    imageId: GENERATED_IMAGE,
    conversationId,
    userMessageId,
    assistantMessageId,
    mimeType: "image/png",
    provider: "mock-provider",
    model: "mock-model",
  };
}

function standardResult() {
  return {
    kind: "standard_operation",
    requestId: REQUEST,
    userId: USER,
    conversationId: CONVERSATION,
    reply: "A safe mock response.",
    model: "mock-model",
    reasoningEffort: "medium",
    measurements: [],
  };
}

function input(capabilityId: string = "standard", resolvedInputs: ExecutionAuthorizationInput["resolvedInputs"] = [{ source: "user", value: "A request." }]): ExecutionAuthorizationInput {
  return {
    executionId: RUN,
    stepId: "step-1",
    capabilityId: capabilityId as ExecutionAuthorizationInput["capabilityId"],
    authenticatedUserId: USER,
    acceptedRequestId: REQUEST,
    acceptanceFingerprint: ACCEPTANCE_FINGERPRINT,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestFingerprint: PLAN_FINGERPRINT,
    conversationId: CONVERSATION,
    requestId: REQUEST,
    requestMessageBinding: { requestId: REQUEST, userId: USER, conversationId: CONVERSATION, userMessageId: USER_MESSAGE, assistantMessageId: ASSISTANT_MESSAGE },
    resolvedInputs,
    resourceReferences: [],
  };
}

function association(overrides: { requestOptions?: unknown; runContext?: unknown; acceptance?: Record<string, unknown>; capability?: string } = {}): DurableExecutionAssociation {
  return {
    run: {
      id: RUN,
      user_id: USER,
      accepted_request_id: REQUEST,
      acceptance_fingerprint: ACCEPTANCE_FINGERPRINT,
      idempotency_key: IDEMPOTENCY_KEY,
      request_fingerprint: PLAN_FINGERPRINT,
      runtime_context: overrides.runContext ?? {
        conversationId: CONVERSATION,
        requestMessageBinding: { requestId: REQUEST, userId: USER, conversationId: CONVERSATION, userMessageId: USER_MESSAGE, assistantMessageId: ASSISTANT_MESSAGE },
        attachments: [],
        resourceReferences: [],
      },
      execution_plan: { steps: [{ id: "step-1", capability: overrides.capability ?? "standard" }] },
    },
    acceptance: {
      request_id: REQUEST,
      user_id: USER,
      conversation_id: CONVERSATION,
      user_message_id: USER_MESSAGE,
      assistant_message_id: ASSISTANT_MESSAGE,
      idempotency_key: IDEMPOTENCY_KEY,
      request_fingerprint: ACCEPTANCE_FINGERPRINT,
      request_options: overrides.requestOptions ?? { routingMode: "auto" },
      ...overrides.acceptance,
    },
  };
}

function fixture(options: {
  plan?: "free" | "pro";
  association?: DurableExecutionAssociation | null;
  currentUser?: string | null;
  overrides?: Partial<ExecutionAuthorizerDependencies>;
} = {}) {
  const deps: ExecutionAuthorizerDependencies = {
    authenticate: async () => options.currentUser === undefined ? USER : options.currentUser,
    loadAccountPlan: async () => ({ plan: options.plan ?? "free" }),
    loadAssociation: async (request) => options.association === undefined ? association({ capability: request.capabilityId }) : options.association,
    validateBinding: async () => true,
    checkConversationOwnership: async () => "owned",
    checkDocument: async () => ({ ownership: "owned", sizeBytes: 1, ready: true }),
    checkUploadedImage: async () => "owned",
    checkGeneratedImage: async () => "owned",
    checkGeneratedDocument: async () => "owned",
    ...options.overrides,
  };
  return { authorizer: createExecutionAuthorizer(deps), deps };
}

describe("concrete execution authorizer", () => {
  it.each([
    ["standard", [{ source: "user", value: "Answer." }]],
    ["web_search", [{ source: "user", value: "Search." }]],
    ["file_analysis", [{ source: "attachment", reference: { id: FILE, kind: "file" } }, { source: "user", value: "Analyze." }]],
    ["document_generation", [{ source: "step", stepId: "prior", result: { kind: "text", value: standardResult() } }]],
    ["image_generation", [{ source: "user", value: "Draw a tree." }]],
    ["image_editing", [{ source: "attachment", reference: { id: UPLOADED_IMAGE, kind: "image" } }, { source: "step", stepId: "prior", result: { kind: "image", value: generatedImage() } }, { source: "user", value: "Edit it." }]],
  ] as const)("allows eligible owned %s operation", async (capability, resolvedInputs) => {
    const { authorizer } = fixture();
    const result = await authorizer.authorize(input(capability, resolvedInputs));
    expect(result).toEqual({ allowed: true });
  });

  it("requires a live authenticated owner and rejects forged persisted identity", async () => {
    expect(await fixture({ currentUser: null }).authorizer.authorize(input())).toMatchObject({ allowed: false, reasonCode: "denied" });
    expect(await fixture({ currentUser: OTHER_USER }).authorizer.authorize(input())).toMatchObject({ allowed: false, reasonCode: "denied" });
    const wrongBinding = input();
    expect(await fixture().authorizer.authorize({ ...wrongBinding, authenticatedUserId: OTHER_USER })).toMatchObject({ allowed: false });
  });

  it("rejects another owner's conversation and keeps resource existence private", async () => {
    const denied = fixture({ overrides: { checkConversationOwnership: async () => "not_owned" } });
    expect(await denied.authorizer.authorize(input())).toEqual({ allowed: false, reasonCode: "denied" });
    const inaccessible = fixture({ overrides: { checkDocument: async () => ({ ownership: "not_owned" }) } });
    const result = await inaccessible.authorizer.authorize(input("file_analysis", [
      { source: "attachment", reference: { id: FILE, kind: "file" } },
      { source: "user", value: "Analyze." },
    ]));
    expect(result).toEqual({ allowed: false, reasonCode: "denied" });
    expect(JSON.stringify(result)).not.toContain(FILE);
  });

  it("rejects another owner's uploaded or generated image and cross-conversation image references", async () => {
    const uploadDenied = fixture({ overrides: { checkUploadedImage: async () => "not_owned" } });
    expect(await uploadDenied.authorizer.authorize(input("image_editing", [
      { source: "attachment", reference: { id: UPLOADED_IMAGE, kind: "image" } },
      { source: "step", stepId: "prior", result: { kind: "image", value: generatedImage() } },
      { source: "user", value: "Edit it." },
    ]))).toMatchObject({ allowed: false, reasonCode: "denied" });
    const generatedDenied = fixture({ overrides: { checkGeneratedImage: async () => "not_owned" } });
    expect(await generatedDenied.authorizer.authorize(input("image_editing", [
      { source: "attachment", reference: { id: UPLOADED_IMAGE, kind: "image" } },
      { source: "step", stepId: "prior", result: { kind: "image", value: generatedImage() } },
      { source: "user", value: "Edit it." },
    ]))).toMatchObject({ allowed: false, reasonCode: "denied" });
    expect(await fixture().authorizer.authorize(input("image_editing", [
      { source: "attachment", reference: { id: UPLOADED_IMAGE, kind: "image" } },
      { source: "step", stepId: "prior", result: { kind: "image", value: generatedImage(OTHER_USER) } },
      { source: "user", value: "Edit it." },
    ]))).toMatchObject({ allowed: false, reasonCode: "denied" });
  });

  it("rejects a foreign, deleted, or unavailable persisted artifact", async () => {
    const doc = { kind: "generated_document", artifactId: ARTIFACT, conversationId: CONVERSATION, messageId: ASSISTANT_MESSAGE, filename: "result.pdf", format: "pdf", mimeType: "application/pdf", sizeBytes: 100, createdAt: "2026-10-08T12:00:00.000Z" };
    const resolved = [
      { source: "step", stepId: "prior", result: { kind: "document", value: doc } },
      { source: "user", value: "Use this artifact." },
    ] as const;
    expect(await fixture({ overrides: { checkGeneratedDocument: async () => "not_owned" } }).authorizer.authorize(input("standard", resolved))).toMatchObject({ allowed: false, reasonCode: "denied" });
    expect(await fixture({ overrides: { checkGeneratedDocument: async () => "unavailable" } }).authorizer.authorize(input("standard", resolved))).toMatchObject({ allowed: false, reasonCode: "authorization_unavailable" });
  });

  it("denies unsupported capabilities and malformed resource references", async () => {
    expect(await fixture().authorizer.authorize(input("experimental"))).toMatchObject({ allowed: false, reasonCode: "denied" });
    const malformed = await fixture().authorizer.authorize(input("file_analysis", [
      { source: "attachment", reference: { id: "not-a-uuid", kind: "file" } } as never,
    ]));
    expect(malformed).toMatchObject({ allowed: false });
  });

  it("uses the current plan for reasoning permission after downgrade", async () => {
    const highReasoning = association({ requestOptions: { routingMode: "auto", reasoningMode: "high" } });
    expect(await fixture({ plan: "free", association: highReasoning }).authorizer.authorize(input())).toMatchObject({ allowed: false, reasonCode: "denied" });
    expect(await fixture({ plan: "pro", association: highReasoning }).authorizer.authorize(input())).toEqual({ allowed: true });
    let currentPlan: "free" | "pro" = "pro";
    const deps = fixture({ association: highReasoning, overrides: { loadAccountPlan: async () => ({ plan: currentPlan }) } });
    expect(await deps.authorizer.authorize(input())).toEqual({ allowed: true });
    currentPlan = "free";
    expect(await deps.authorizer.authorize(input())).toMatchObject({ allowed: false, reasonCode: "denied" });
  });

  it("rechecks session, plan, binding, and ownership on each resume or retry authorization", async () => {
    let session: string | null = USER;
    let bindingValid = true;
    const checkDocument = vi.fn(async () => ({ ownership: "owned" as const, sizeBytes: 1, ready: true }));
    const { authorizer } = fixture({ overrides: {
      authenticate: async () => session,
      validateBinding: async () => bindingValid,
      checkDocument,
    } });
    const request = input("file_analysis", [{ source: "attachment", reference: { id: FILE, kind: "file" } }, { source: "user", value: "Analyze." }]);
    expect(await authorizer.authorize(request)).toEqual({ allowed: true });
    bindingValid = false;
    expect(await authorizer.authorize(request)).toMatchObject({ allowed: false, reasonCode: "denied" });
    session = null;
    expect(await authorizer.authorize(request)).toMatchObject({ allowed: false, reasonCode: "denied" });
    expect(checkDocument).toHaveBeenCalledTimes(2);
  });

  it("fails closed for missing durable association, background recovery, and database failure", async () => {
    expect(await fixture({ association: null }).authorizer.authorize(input())).toMatchObject({ allowed: false, reasonCode: "denied" });
    expect(await fixture({ currentUser: null }).authorizer.authorize(input())).toMatchObject({ allowed: false });
    expect(await fixture({ overrides: { loadAssociation: async () => { throw new Error("private DB detail"); } } }).authorizer.authorize(input()))
      .toEqual({ allowed: false, reasonCode: "authorization_unavailable" });
  });

  it("does not reserve chat usage or invoke providers; authorization has no side-effect dependency", async () => {
    const provider = vi.fn(async () => ({ kind: "text" as const, value: "No dispatch." }));
    const reserveDailyUsage = vi.fn();
    const { authorizer, deps } = fixture({ currentUser: null });
    const runtime = createLvtChatExecutionRuntime({
      executor: { execute: provider },
      authorizer,
      requestMessageBindingValidator: { validate: async () => true },
    });
    const steps = [{ id: "step-1", capability: "standard" as const, dependsOn: [] as string[], inputs: [{ source: "user" as const }], expectedOutput: "text" as const }];
    const outcome = await runtime.execute({
      version: 1,
      objective: "Answer safely.",
      plan: { objective: "Answer safely.", steps, status: "validated" },
      orderedStepIds: ["step-1"],
      plannerSource: "deterministic",
      governance: { maxSteps: 1, capabilityIds: ["standard"], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1 },
    }, {
      authenticatedUserId: USER,
      conversationId: CONVERSATION,
      requestMessageBinding: { requestId: REQUEST, userId: USER, conversationId: CONVERSATION, userMessageId: USER_MESSAGE, assistantMessageId: ASSISTANT_MESSAGE },
      userInput: "Answer this.",
    });
    expect(outcome).toMatchObject({ kind: "failed", failure: { code: "authorization_denied" } });
    expect(provider).not.toHaveBeenCalled();
    expect(reserveDailyUsage).not.toHaveBeenCalled();
    expect("reserveDailyUsage" in deps).toBe(false);
  });
});
