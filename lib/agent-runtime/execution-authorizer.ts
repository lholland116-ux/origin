import { CAPABILITY_REGISTRY, type CapabilityId } from "@/lib/ai/capability-registry";
import { parseUserReasoningMode } from "@/lib/ai/reasoning-mode";
import { resolveAccountPlan, type AccountPlanResolution } from "@/lib/capabilities/account-plan";
import { preflightCapability, type CapabilityPreflightPolicy, type OwnershipResult } from "@/lib/capabilities/preflight";
import type { CapabilityResourceReference, CapabilityServiceContext } from "@/lib/capabilities/service-context";
import { getDocumentLimits } from "@/lib/documents/config";
import type { ExecutionAuthorizationDecision, ExecutionAuthorizationInput } from "@/lib/agent-runtime/capability-executor";
import { requestMessageBindingSchema, generatedDocumentReferenceSchema, generatedImageReferenceSchema, standardOperationResultSchema } from "@/lib/agent-runtime/application-contracts";
import { EXECUTION_CAPABILITY_IDS } from "@/lib/agent-runtime/execution-registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DurableExecutionAssociation = Readonly<{
  run: Record<string, unknown>;
  acceptance: Record<string, unknown>;
}>;

export type ExecutionAuthorizerDependencies = Readonly<{
  authenticate: () => Promise<string | null>;
  loadAccountPlan: (userId: string) => Promise<{ plan: unknown | null; error?: unknown | null }>;
  loadAssociation: (input: ExecutionAuthorizationInput) => Promise<DurableExecutionAssociation | null>;
  validateBinding: (input: ExecutionAuthorizationInput["requestMessageBinding"]) => Promise<boolean>;
  checkConversationOwnership: (userId: string, conversationId: string) => Promise<OwnershipResult>;
  checkDocument: (input: { userId: string; conversationId: string; id: string }) => Promise<{ ownership: OwnershipResult; sizeBytes?: number; ready?: boolean }>;
  checkUploadedImage: (input: { userId: string; conversationId: string; userMessageId: string; id: string }) => Promise<OwnershipResult>;
  checkGeneratedImage: (input: { userId: string; conversationId: string; assistantMessageId: string; id: string }) => Promise<OwnershipResult>;
  checkGeneratedDocument: (input: { userId: string; conversationId: string; assistantMessageId: string; id: string }) => Promise<OwnershipResult>;
}>;

type Candidate = Readonly<{
  reference: CapabilityResourceReference;
  check: () => Promise<{ ownership: OwnershipResult; sizeBytes?: number; ready?: boolean }>;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bindingMatches(a: unknown, b: ExecutionAuthorizationInput["requestMessageBinding"]): boolean {
  const parsed = requestMessageBindingSchema.safeParse(a);
  return parsed.success && parsed.data.requestId === b.requestId && parsed.data.userId === b.userId
    && parsed.data.conversationId === b.conversationId && parsed.data.userMessageId === b.userMessageId
    && parsed.data.assistantMessageId === b.assistantMessageId;
}

function associationMatches(value: DurableExecutionAssociation | null, input: ExecutionAuthorizationInput): boolean {
  if (!value || !input.acceptedRequestId || !input.acceptanceFingerprint || !input.idempotencyKey || !input.requestFingerprint) return false;
  const { run, acceptance } = value;
  const context = run.runtime_context;
  const requestOptions = acceptance.request_options;
  const acceptedReasoningMode = record(requestOptions) ? requestOptions.reasoningMode : undefined;
  return run.id === input.executionId && run.user_id === input.authenticatedUserId
    && run.accepted_request_id === input.acceptedRequestId && input.acceptedRequestId === input.requestMessageBinding.requestId
    && run.acceptance_fingerprint === input.acceptanceFingerprint
    && run.idempotency_key === input.idempotencyKey && run.request_fingerprint === input.requestFingerprint
    && acceptance.request_id === input.acceptedRequestId && acceptance.user_id === input.authenticatedUserId
    && acceptance.conversation_id === input.conversationId
    && acceptance.user_message_id === input.requestMessageBinding.userMessageId
    && acceptance.assistant_message_id === input.requestMessageBinding.assistantMessageId
    && acceptance.idempotency_key === input.idempotencyKey
    && acceptance.request_fingerprint === input.acceptanceFingerprint
    && record(context) && context.conversationId === input.conversationId
    && context.reasoningMode === acceptedReasoningMode
    && input.reasoningMode === acceptedReasoningMode
    && bindingMatches(context.requestMessageBinding, input.requestMessageBinding)
    && record(run.execution_plan)
    && Array.isArray(run.execution_plan.steps)
    && run.execution_plan.steps.some((step) => record(step) && step.id === input.stepId && step.capability === input.capabilityId);
}

function generatedImageValue(value: unknown): ReturnType<typeof generatedImageReferenceSchema.parse> | null {
  const direct = generatedImageReferenceSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (record(value)) {
    const nested = generatedImageReferenceSchema.safeParse(value.reference);
    if (nested.success) return nested.data;
  }
  return null;
}

function generatedDocumentValue(value: unknown): ReturnType<typeof generatedDocumentReferenceSchema.parse> | null {
  const parsed = generatedDocumentReferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function executionRequestOptions(association: DurableExecutionAssociation): unknown {
  return association.acceptance.request_options;
}

function capabilitySupported(capabilityId: string): capabilityId is CapabilityId {
  return EXECUTION_CAPABILITY_IDS.includes(capabilityId as CapabilityId) && CAPABILITY_REGISTRY.has(capabilityId);
}

/** Creates an authorizer that trusts only the current Supabase session, never persisted/caller identity alone. */
export function createExecutionAuthorizer(dependencies: ExecutionAuthorizerDependencies) {
  return Object.freeze({
    async authorize(input: ExecutionAuthorizationInput): Promise<ExecutionAuthorizationDecision> {
      if (!input || typeof input !== "object" || !capabilitySupported(input.capabilityId)) {
        return { allowed: false, reasonCode: "denied" };
      }
      const binding = requestMessageBindingSchema.safeParse(input.requestMessageBinding);
      if (!binding.success || binding.data.userId !== input.authenticatedUserId
        || binding.data.conversationId !== input.conversationId || binding.data.requestId !== input.requestId) {
        return { allowed: false, reasonCode: "denied" };
      }

      try {
        const currentUserId = await dependencies.authenticate();
        if (!currentUserId || currentUserId !== input.authenticatedUserId) return { allowed: false, reasonCode: "denied" };

        const association = await dependencies.loadAssociation(input);
        if (!association || !associationMatches(association, input)) return { allowed: false, reasonCode: "denied" };

        const account: AccountPlanResolution = await resolveAccountPlan({ userId: currentUserId, lookup: dependencies.loadAccountPlan });
        if (account.kind !== "resolved") return { allowed: false, reasonCode: "authorization_unavailable" };

        const parsedReasoning = parseUserReasoningMode(executionRequestOptions(association));
        if (parsedReasoning.kind === "invalid") return { allowed: false, reasonCode: "denied" };
        const reasoning = input.capabilityId === "standard" || input.capabilityId === "web_search"
          ? parsedReasoning
          : undefined;

        const candidates: Candidate[] = [];
        const attachments: Array<{ id: string; kind: "file" | "image" }> = [];
        const userInputs: string[] = [];
        const refs = input.resolvedInputs;
        if (!Array.isArray(refs)) return { allowed: false, reasonCode: "denied" };
        for (const resolved of refs) {
          if (!record(resolved)) return { allowed: false, reasonCode: "denied" };
          if (resolved.source === "user") {
            if (typeof resolved.value !== "string") return { allowed: false, reasonCode: "denied" };
            userInputs.push(resolved.value);
            continue;
          }
          if (resolved.source === "attachment") {
            const reference = resolved.reference;
            if (!record(reference) || typeof reference.id !== "string" || !UUID_PATTERN.test(reference.id)
              || (reference.kind !== "file" && reference.kind !== "image")) {
              return { allowed: false, reasonCode: "denied" };
            }
            const kind = reference.kind;
            const resourceId = reference.id as string;
            attachments.push({ id: resourceId, kind });
            if (kind === "file") {
              candidates.push({
                reference: { id: resourceId, kind: "file" },
                check: () => dependencies.checkDocument({ userId: currentUserId, conversationId: input.conversationId, id: resourceId }),
              });
            } else {
              candidates.push({
                reference: { id: resourceId, kind: "image" },
                check: async () => ({ ownership: await dependencies.checkUploadedImage({ userId: currentUserId, conversationId: input.conversationId, userMessageId: binding.data.userMessageId, id: resourceId }) }),
              });
            }
            continue;
          }
          if (resolved.source !== "step" || !record(resolved.result) || typeof resolved.stepId !== "string") {
            return { allowed: false, reasonCode: "denied" };
          }
          const result = resolved.result;
          const rawResultRef = result.ref;
          if (rawResultRef !== undefined && (!record(rawResultRef) || typeof rawResultRef.id !== "string"
            || !UUID_PATTERN.test(rawResultRef.id) || !["file", "image", "artifact", "document"].includes(String(rawResultRef.kind)))) {
            return { allowed: false, reasonCode: "denied" };
          }
          const resultRef = rawResultRef as { id: string; kind: "file" | "image" | "artifact" | "document" } | undefined;
          if (result.kind === "image") {
            const image = generatedImageValue(result.value);
            if (!image || image.conversationId !== input.conversationId || image.userMessageId !== binding.data.userMessageId
              || image.assistantMessageId !== binding.data.assistantMessageId
              || (resultRef !== undefined && (resultRef.id !== image.imageId || resultRef.kind !== "image"))) {
              return { allowed: false, reasonCode: "denied" };
            }
            candidates.push({
              reference: { id: image.imageId, kind: "image" },
              check: async () => ({ ownership: await dependencies.checkGeneratedImage({ userId: currentUserId, conversationId: input.conversationId, assistantMessageId: binding.data.assistantMessageId, id: image.imageId }) }),
            });
          } else if (result.kind === "document" || result.kind === "artifact") {
            const document = generatedDocumentValue(result.value);
            if (!document || document.conversationId !== input.conversationId || document.messageId !== binding.data.assistantMessageId
              || (resultRef !== undefined && (resultRef.id !== document.artifactId || !["document", "artifact"].includes(resultRef.kind)))) {
              return { allowed: false, reasonCode: "denied" };
            }
            candidates.push({
              reference: { id: document.artifactId, kind: "artifact" },
              check: async () => ({ ownership: await dependencies.checkGeneratedDocument({ userId: currentUserId, conversationId: input.conversationId, assistantMessageId: binding.data.assistantMessageId, id: document.artifactId }) }),
            });
          } else if (resultRef !== undefined) {
            const kind: CapabilityResourceReference["kind"] = resultRef.kind === "document" ? "artifact" : resultRef.kind;
            const resourceId = resultRef.id;
            candidates.push({
              reference: { id: resourceId, kind },
              check: kind === "file"
                ? () => dependencies.checkDocument({ userId: currentUserId, conversationId: input.conversationId, id: resourceId })
                : kind === "image"
                  ? async () => ({ ownership: await dependencies.checkGeneratedImage({ userId: currentUserId, conversationId: input.conversationId, assistantMessageId: binding.data.assistantMessageId, id: resourceId }) })
                  : async () => ({ ownership: await dependencies.checkGeneratedDocument({ userId: currentUserId, conversationId: input.conversationId, assistantMessageId: binding.data.assistantMessageId, id: resourceId }) }),
            });
          }
        }

        const stepInputs = refs.filter((item) => item.source === "step");
        if (["standard", "web_search", "image_generation", "image_editing"].includes(input.capabilityId)
          && (userInputs.length !== 1 || !userInputs[0]?.trim())) return { allowed: false, reasonCode: "denied" };
        if ((input.capabilityId === "file_analysis" || input.capabilityId === "document_generation") && userInputs.length > 1) {
          return { allowed: false, reasonCode: "denied" };
        }
        if (input.capabilityId === "file_analysis" && (attachments.length < 1 || attachments.some((item) => item.kind !== "file"))) {
          return { allowed: false, reasonCode: "denied" };
        }
        if (input.capabilityId === "image_editing" && (attachments.length < 1 || attachments.some((item) => item.kind !== "image")
          || stepInputs.length !== 1 || stepInputs[0]?.result.kind !== "image")) return { allowed: false, reasonCode: "denied" };
        if ((input.capabilityId === "image_generation" || input.capabilityId === "web_search")
          && (attachments.length > 0 || stepInputs.length > 0)) return { allowed: false, reasonCode: "denied" };
        if (input.capabilityId === "document_generation") {
          if (attachments.length > 0 || stepInputs.length !== 1 || stepInputs[0]?.result.kind !== "text") return { allowed: false, reasonCode: "denied" };
          const standard = standardOperationResultSchema.safeParse(stepInputs[0]?.result.value);
          if (!standard.success || standard.data.requestId !== binding.data.requestId || standard.data.userId !== currentUserId
            || standard.data.conversationId !== input.conversationId) return { allowed: false, reasonCode: "denied" };
        }

        const typedResources = new Map<string, OwnershipResult>();
        for (const candidate of candidates) {
          const result = await candidate.check();
          let ownership = result.ownership;
          if (ownership === "owned" && candidate.reference.kind === "file") {
            const limits = getDocumentLimits(account.plan);
            if (!result.ready || !Number.isSafeInteger(result.sizeBytes) || (result.sizeBytes ?? 0) <= 0
              || (result.sizeBytes ?? 0) > limits.maxFileSizeBytes) ownership = "not_owned";
          }
          typedResources.set(`${candidate.reference.kind}:${candidate.reference.id}`, ownership);
          if (ownership !== "owned") return { allowed: false, reasonCode: ownership === "unavailable" ? "authorization_unavailable" : "denied" };
        }
        if (attachments.filter((item) => item.kind === "file").length > getDocumentLimits(account.plan).maxFilesPerMessage) {
          return { allowed: false, reasonCode: "denied" };
        }

        if (await dependencies.validateBinding(binding.data) !== true) return { allowed: false, reasonCode: "denied" };

        const serviceContext: CapabilityServiceContext = {
          kind: "conversation",
          userId: currentUserId,
          conversationId: input.conversationId,
          attachmentRefs: candidates.filter((candidate) => candidate.reference.kind === "file").map((candidate) => ({ id: candidate.reference.id, kind: "file" as const })),
          imageRefs: candidates.filter((candidate) => candidate.reference.kind === "image").map((candidate) => ({ id: candidate.reference.id, kind: "image" as const })),
          artifactRefs: candidates.filter((candidate) => candidate.reference.kind === "artifact").map((candidate) => ({ id: candidate.reference.id, kind: "artifact" as const })),
          ...(reasoning?.kind === "valid" ? { reasoningMode: reasoning.mode } : {}),
          requestId: input.requestId,
        };
        const policy: CapabilityPreflightPolicy = {
          isEnabled: (capabilityId) => EXECUTION_CAPABILITY_IDS.includes(capabilityId),
          // Existing product routes make all six registered capabilities available on Free and Pro;
          // plan-specific document/image/chat quotas are enforced by their existing atomic services.
          isEntitled: (plan, capabilityId) => (plan === "free" || plan === "pro") && EXECUTION_CAPABILITY_IDS.includes(capabilityId),
          checkConversationOwnership: dependencies.checkConversationOwnership,
          checkOwnership: async (_userId, resource) => typedResources.get(`${resource.kind}:${resource.id}`) ?? "not_owned",
        };
        const preflight = await preflightCapability({ context: serviceContext, capabilityId: input.capabilityId, account, ...(reasoning ? { reasoning } : {}), policy });
        if (preflight.kind === "denied") {
          return { allowed: false, reasonCode: preflight.reason === "resource_unavailable" || preflight.reason === "account_state_unavailable"
            || preflight.reason === "quota_unavailable" ? "authorization_unavailable" : "denied" };
        }
        return { allowed: true };
      } catch {
        return { allowed: false, reasonCode: "authorization_unavailable" };
      }
    },
  });
}

const productionDependencies: ExecutionAuthorizerDependencies = {
  authenticate: async () => {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.auth.getUser();
    if (error) throw new Error("Authentication lookup failed.");
    return data.user?.id ?? null;
  },
  loadAccountPlan: async (userId) => {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.from("profiles").select("plan").eq("id", userId).maybeSingle();
    return { plan: data?.plan ?? null, error };
  },
  loadAssociation: async (input) => {
    const session = await createServerSupabaseClient();
    const { data: run, error: runError } = await session.from("execution_runs")
      .select("id,user_id,accepted_request_id,acceptance_fingerprint,idempotency_key,request_fingerprint,runtime_context,execution_plan")
      .eq("id", input.executionId).eq("user_id", input.authenticatedUserId).maybeSingle();
    if (runError) throw new Error("Execution association lookup failed.");
    if (!run) return null;
    // The acceptance ledger is intentionally inaccessible to authenticated users. This
    // service-role lookup is read-only and scoped to the identity just verified by auth.getUser.
    const admin = createAdminClient();
    const { data: acceptance, error: acceptanceError } = await admin.from("agent_request_acceptances")
      .select("request_id,user_id,conversation_id,user_message_id,assistant_message_id,idempotency_key,request_fingerprint,request_options")
      .eq("request_id", input.requestId ?? "").eq("user_id", input.authenticatedUserId).maybeSingle();
    if (acceptanceError) throw new Error("Request acceptance lookup failed.");
    return acceptance ? { run: run as unknown as Record<string, unknown>, acceptance: acceptance as unknown as Record<string, unknown> } : null;
  },
  validateBinding: async (input) => {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.rpc("validate_agent_request_message_binding", {
      p_request_id: input.requestId,
      p_conversation_id: input.conversationId,
      p_user_message_id: input.userMessageId,
      p_assistant_message_id: input.assistantMessageId,
    });
    if (error) throw new Error("Request binding validation failed.");
    return data === true;
  },
  checkConversationOwnership: async (userId, conversationId) => {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.from("conversations").select("id").eq("id", conversationId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error("Conversation authorization lookup failed.");
    return data ? "owned" : "not_owned";
  },
  checkDocument: async ({ userId, conversationId, id }) => {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.from("documents").select("id,size_bytes,extraction_status,extracted_text")
      .eq("id", id).eq("user_id", userId).eq("conversation_id", conversationId).maybeSingle();
    if (error) throw new Error("Document authorization lookup failed.");
    return data ? { ownership: "owned", sizeBytes: Number(data.size_bytes), ready: data.extraction_status === "ready" && typeof data.extracted_text === "string" && Boolean(data.extracted_text.trim()) }
      : { ownership: "not_owned" };
  },
  checkUploadedImage: async ({ userId, conversationId, userMessageId, id }) => {
    const client = await createServerSupabaseClient();
    const { data: image, error: imageError } = await client.from("message_images").select("id,message_id").eq("id", id).maybeSingle();
    if (imageError) throw new Error("Image authorization lookup failed.");
    if (!image) return "not_owned";
    const { data: message, error: messageError } = await client.from("messages").select("id").eq("id", image.message_id)
      .eq("id", userMessageId).eq("user_id", userId).eq("conversation_id", conversationId).eq("role", "user").maybeSingle();
    if (messageError) throw new Error("Image message authorization lookup failed.");
    return message ? "owned" : "not_owned";
  },
  checkGeneratedImage: async ({ userId, conversationId, assistantMessageId, id }) => {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.from("message_generated_images").select("id,message_id")
      .eq("id", id).eq("user_id", userId).eq("conversation_id", conversationId).maybeSingle();
    if (error) throw new Error("Generated image authorization lookup failed.");
    return data?.message_id === assistantMessageId ? "owned" : "not_owned";
  },
  checkGeneratedDocument: async ({ userId, conversationId, assistantMessageId, id }) => {
    // This table is intentionally service-role-only. The session identity is verified first,
    // and the privileged read is constrained by every ownership/binding column.
    const admin = createAdminClient();
    const { data, error } = await admin.from("generated_documents").select("id")
      .eq("id", id).eq("user_id", userId).eq("conversation_id", conversationId).eq("message_id", assistantMessageId).maybeSingle();
    if (error) throw new Error("Generated document authorization lookup failed.");
    return data ? "owned" : "not_owned";
  },
};

/** Background recovery without a current authenticated session is denied by default. */
export const executionAuthorizer = createExecutionAuthorizer(productionDependencies);
