import "server-only";
import { createServerAcceptedExecutionComposition } from "@/lib/agent-runtime/server-execution-composition";
import { createSupabaseDatabaseSql } from "@/lib/database/supabase/supabase-transactions";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requestMessageBindingValidator } from "@/lib/agent-runtime/request-message-binding";
import { createWorkflowHttpHandlers, readWorkflowFeatureGate } from "@/lib/agent-runtime/workflow-http-api";
import type { ExecutionStore } from "@/lib/agent-runtime/execution-store";

let store: ExecutionStore | undefined;
let composer: ReturnType<typeof createServerAcceptedExecutionComposition> | undefined;

function getStore(): ExecutionStore {
  if (!store) store = new SupabaseExecutionStore(createSupabaseDatabaseSql({ maximum_connections: 1 }));
  return store;
}

function getComposer(): ReturnType<typeof createServerAcceptedExecutionComposition> {
  if (!composer) composer = createServerAcceptedExecutionComposition(getStore());
  return composer;
}

export const workflowHttpHandlers = createWorkflowHttpHandlers({
  getGate: () => readWorkflowFeatureGate(),
  authenticate: async () => {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  loadCurrentPlan: async (userId) => {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.from("profiles").select("plan").eq("id", userId).maybeSingle();
    if (error) throw new Error("Account entitlement lookup failed.");
    return data?.plan === "free" || data?.plan === "pro" ? data.plan : null;
  },
  prepare: (input) => getComposer().prepare(input),
  getRun: (runId, userId) => getStore().getRun({ runId, userId }),
  validateBinding: async (run) => {
    const binding = run.runtimeContext.requestMessageBinding;
    return binding ? requestMessageBindingValidator.validate(binding) : false;
  },
  validateAcceptance: async (run) => {
    const binding = run.runtimeContext.requestMessageBinding;
    if (!binding || !run.acceptedRequestId || !run.acceptanceFingerprint) return false;
    const associated = await getStore().lookupAcceptedRequestRun({
      requestId: run.acceptedRequestId,
      userId: run.userId,
      conversationId: binding.conversationId,
      userMessageId: binding.userMessageId,
      assistantMessageId: binding.assistantMessageId,
      idempotencyKey: run.idempotencyKey,
      requestFingerprint: run.acceptanceFingerprint,
    });
    return associated.status === "found" && associated.run.id === run.id;
  },
  mutateControl: ({ runId, userId, action, expectedControlRevision }) => {
    const input = { runId, authenticatedUserId: userId, expectedControlRevision };
    switch (action) {
      case "pause": return getComposer().control.pause(input);
      case "resume": return getComposer().control.resume(input);
      case "stop": return getComposer().control.stop(input);
    }
  },
  decideApproval: ({ runId, userId, checkpointId, decision, expectedControlRevision, rationale }) => {
    const input = { runId, authenticatedUserId: userId, checkpointId, expectedControlRevision };
    if (decision === "approve") return getComposer().control.approveCheckpoint(input);
    return getComposer().control.returnCheckpoint({ ...input, rationale: rationale! });
  },
  ownsConversation: async (conversationId, userId) => {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.from("conversations").select("id")
      .eq("id", conversationId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error("Conversation authorization lookup failed.");
    return Boolean(data);
  },
  configuredAppUrl: process.env.NEXT_PUBLIC_APP_URL,
});
