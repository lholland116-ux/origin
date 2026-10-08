import { describe, expect, it, vi } from "vitest";
import { createIntelligenceDecisionCoordinator, type IntelligenceDecision } from "@/lib/ai/intelligence-decision-coordinator";
import { fingerprintAgentRequest, type AgentRequestAcceptanceInput } from "@/lib/agent-runtime/request-acceptance";
import { createAcceptedExecutionComposer, type AcceptedExecutionCompositionDependencies } from "@/lib/agent-runtime/accepted-execution-composition";
import type { AcceptedRequestExecutionIdentity, DurableExecutionRun, LookupAcceptedExecutionRunResult } from "@/lib/agent-runtime/execution-store";
import type { RuntimeAttachmentReference } from "@/lib/agent-runtime/capability-executor";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";

const USER = "a2000000-0000-4000-8000-000000000001";
const CONVERSATION = "b2000000-0000-4000-8000-000000000001";
const REQUEST = "c2000000-0000-4000-8000-000000000001";
const USER_MESSAGE = "c2000000-0000-4000-8000-000000000002";
const ASSISTANT_MESSAGE = "c2000000-0000-4000-8000-000000000003";
const RUN = "e2000000-0000-4000-8000-000000000001";
const RUN_FINGERPRINT = "d".repeat(64);

const request: AgentRequestAcceptanceInput = {
  conversationId: CONVERSATION,
  idempotencyKey: "f2000000-0000-4000-8000-000000000001",
  message: "Search the latest FDA QMSR changes and create a PDF briefing.",
  documentIds: [],
  images: [],
  requestOptions: { routingMode: "auto", reasoningMode: "high" },
};

const binding = {
  requestId: REQUEST,
  userId: USER,
  conversationId: CONVERSATION,
  userMessageId: USER_MESSAGE,
  assistantMessageId: ASSISTANT_MESSAGE,
};

const persistedRun = {
  id: RUN,
  userId: USER,
  requestFingerprint: RUN_FINGERPRINT,
  executionPlan: { version: 1, steps: [], orderedStepIds: [], plannerSource: "deterministic", governance: {} },
  runtimeContext: { conversationId: CONVERSATION, requestMessageBinding: binding, attachments: [], resourceReferences: [] },
} as unknown as DurableExecutionRun;

function accepted(raw: AgentRequestAcceptanceInput) {
  return {
    kind: "accepted" as const,
    replayed: false,
    idempotencyKey: raw.idempotencyKey,
    requestFingerprint: fingerprintAgentRequest(raw),
    binding,
    usageDate: "2026-10-08",
  };
}

function identity(): AcceptedRequestExecutionIdentity {
  return {
    requestId: REQUEST,
    userId: USER,
    conversationId: CONVERSATION,
    userMessageId: USER_MESSAGE,
    assistantMessageId: ASSISTANT_MESSAGE,
    idempotencyKey: request.idempotencyKey,
    requestFingerprint: fingerprintAgentRequest(request),
  };
}

function fixture(options: {
  lookup?: (identity: AcceptedRequestExecutionIdentity) => Promise<LookupAcceptedExecutionRunResult>;
  decide?: AcceptedExecutionCompositionDependencies["decide"];
  resolveImages?: (binding: RequestMessageBinding) => Promise<readonly RuntimeAttachmentReference[]>;
} = {}) {
  const accept = vi.fn(async (raw: unknown) => accepted(raw as AgentRequestAcceptanceInput));
  const lookup = vi.fn(options.lookup ?? (async () => ({ status: "not_found" as const })));
  const resolveImages = vi.fn(options.resolveImages ?? (async () => []));
  const decide = vi.fn(options.decide ?? ((input) => createIntelligenceDecisionCoordinator({ modelPlanningAllowed: false }).decideIntelligenceAction(input)));
  const associate = vi.fn<AcceptedExecutionCompositionDependencies["associate"]>(async () => ({ kind: "associated", status: "created", runId: RUN, planFingerprint: RUN_FINGERPRINT }));
  const composer = createAcceptedExecutionComposer({ accept, lookup, resolveImages, decide, associate });
  return { composer, accept, lookup, resolveImages, decide, associate };
}

describe("accepted-request execution composition", () => {
  it("validates and associates the deterministic File/Web -> Standard -> Document handoff without dispatch", async () => {
    const deps = fixture({ lookup: async () => ({ status: "not_found" }) });
    deps.lookup.mockResolvedValueOnce({ status: "not_found" }).mockResolvedValueOnce({ status: "found", run: persistedRun });
    const result = await deps.composer.prepare(request);
    expect(result).toMatchObject({ kind: "associated", run: { id: RUN } });
    expect(deps.accept).toHaveBeenCalledOnce();
    expect(deps.decide).toHaveBeenCalledOnce();
    expect(deps.associate).toHaveBeenCalledOnce();
    expect(deps.lookup).toHaveBeenCalledTimes(2);
    const [handoff, runtimeInput, acceptedIdentity] = deps.associate.mock.calls[0]!;
    expect(handoff).toMatchObject({ plan: { status: "validated", steps: [
      { capability: "web_search", inputs: [{ source: "user" }] },
      { capability: "standard", inputs: [{ source: "user" }, { source: "step", stepId: "step-1" }] },
      { capability: "document_generation", inputs: [{ source: "step", stepId: "step-2", output: "text" }] },
    ] } });
    const standard = (handoff as { plan: { steps: Array<{ inputs?: Array<{ source: string }> }> } }).plan.steps[1]!;
    expect(standard.inputs?.filter(({ source }) => source === "user")).toHaveLength(1);
    expect(runtimeInput).toMatchObject({
      userInput: request.message,
      reasoningMode: "high",
      authenticatedUserId: USER,
      conversationId: CONVERSATION,
      requestMessageBinding: binding,
    });
    expect(acceptedIdentity).toEqual(identity());
    // Association only persists the handoff. The composer exposes no dispatcher.
    expect("dispatch" in deps.composer).toBe(false);
  });

  it("returns an existing persisted plan before resolving inputs or replanning", async () => {
    const deps = fixture({ lookup: async () => ({ status: "found", run: persistedRun }) });
    const result = await deps.composer.prepare(request);
    expect(result).toMatchObject({ kind: "associated", status: "existing", run: { id: RUN, requestFingerprint: RUN_FINGERPRINT } });
    expect(deps.lookup).toHaveBeenCalledOnce();
    expect(deps.decide).not.toHaveBeenCalled();
    expect(deps.resolveImages).not.toHaveBeenCalled();
    expect(deps.associate).not.toHaveBeenCalled();
  });

  it("rejects a changed request fingerprint before lookup or planning", async () => {
    const deps = fixture();
    deps.accept.mockResolvedValueOnce({ ...accepted(request), requestFingerprint: "0".repeat(64) });
    expect(await deps.composer.prepare(request)).toMatchObject({ kind: "rejected", reason: "conflict", acceptedRequest: { requestId: REQUEST, idempotencyKey: request.idempotencyKey } });
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(deps.decide).not.toHaveBeenCalled();
  });

  it("rejects malformed handoffs before association", async () => {
    const invalid = {
      kind: "multi_step" as const,
      handoff: {
        version: 1 as const,
        objective: request.message,
        plannerSource: "model" as const,
        plan: { objective: request.message, status: "validated" as const, steps: [
          { id: "answer", capability: "standard" as const, dependsOn: ["missing"], inputs: [{ source: "step" as const, stepId: "missing" }], expectedOutput: "text" as const },
          { id: "document", capability: "document_generation" as const, dependsOn: ["answer"], inputs: [{ source: "step" as const, stepId: "answer", output: "text" as const }], expectedOutput: "document" as const },
        ] },
        orderedStepIds: ["answer", "document"],
        governance: { maxSteps: 6, capabilityIds: ["standard", "document_generation"], modelPlanningAllowed: false, maxModelCalls: 2, maxRepairAttempts: 1, attachmentContextAllowed: true, handoffVersion: 1 },
      },
      telemetry: {} as never,
    } as unknown as IntelligenceDecision;
    const deps = fixture({ decide: async () => invalid });
    expect(await deps.composer.prepare(request)).toMatchObject({ kind: "rejected", reason: "invalid_handoff", acceptedRequest: { requestId: REQUEST, idempotencyKey: request.idempotencyKey } });
    expect(deps.associate).not.toHaveBeenCalled();
  });

  it("keeps single-step requests on the existing direct-chat path", async () => {
    const decision = await createIntelligenceDecisionCoordinator().decideIntelligenceAction({
      prompt: "Explain ISO 14971.", router: { mode: "auto", hasImageContext: false },
    });
    const simpleRequest = { ...request, message: "Explain ISO 14971." };
    const deps = fixture({ decide: async () => decision });
    expect(await deps.composer.prepare(simpleRequest)).toMatchObject({ kind: "single_step" });
    expect(deps.associate).not.toHaveBeenCalled();
  });

  it("maps accepted image row IDs and preserves original attachment identity", async () => {
    const withImage = { ...request, images: [{ imagePath: "owned/path.png", imageName: "photo.png" }] };
    const imageAttachment = { id: "d2000000-0000-4000-8000-000000000001", kind: "image" as const };
    const deps = fixture({ resolveImages: async () => [imageAttachment] });
    const originalDecision = await createIntelligenceDecisionCoordinator({ modelPlanningAllowed: false }).decideIntelligenceAction({
      prompt: "Analyze this image and create a PDF report.",
      router: { mode: "auto", hasImageContext: false, hasImageAttachment: true },
      attachments: ["image"],
    });
    deps.decide.mockResolvedValueOnce(originalDecision);
    deps.lookup.mockResolvedValueOnce({ status: "not_found" }).mockResolvedValueOnce({ status: "found", run: persistedRun });
    const result = await deps.composer.prepare({ ...withImage, message: "Analyze this image and create a PDF report." });
    expect(result.kind).toBe("associated");
    expect(deps.associate.mock.calls[0]?.[1].attachments).toEqual([imageAttachment]);
    expect(deps.decide.mock.calls[0]?.[0].attachments).toEqual(["image"]);
  });
});
