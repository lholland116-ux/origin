import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requestMessageBindingSchema,
  type RequestMessageBinding,
} from "@/lib/agent-runtime/application-contracts";
import type { RequestMessageBindingValidator } from "@/lib/agent-runtime/capability-executor";
import { PENDING_ASSISTANT_MESSAGE_PREFIX } from "@/lib/chat/request-message-visibility";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FINAL_MESSAGE_LENGTH = 200_000;

export type RequestMessageBindingSeed = Readonly<{
  requestId: string;
  userId: string;
  conversationId: string;
  userMessageId: string;
}>;

export type RequestMessageBindingServiceDependencies = Readonly<{
  createAssistantDestination: (input: Pick<RequestMessageBinding, "requestId" | "userId" | "conversationId" | "userMessageId">) => Promise<string>;
  validateBinding: (input: RequestMessageBinding) => Promise<boolean>;
  finalizeAssistantMessage: (input: RequestMessageBinding & { finalText: string }) => Promise<void>;
}>;

export class RequestMessageBindingError extends Error {
  constructor(readonly code: "invalid_binding" | "ownership_denied" | "message_unavailable" | "persistence_failed" | "finalization_conflict") {
    super("The request message binding could not be safely established.");
    this.name = "RequestMessageBindingError";
  }
}

type RpcClient = Readonly<{
  auth: Readonly<{ getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> }>;
  rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}>;

async function authenticatedRpcClient(expectedUserId: string): Promise<RpcClient> {
  const client = await createServerSupabaseClient();
  const rpcClient = client as unknown as RpcClient;
  const { data, error } = await rpcClient.auth.getUser();
  if (error || !data.user || data.user.id !== expectedUserId) {
    throw new RequestMessageBindingError("ownership_denied");
  }
  return rpcClient;
}

const defaultDependencies: RequestMessageBindingServiceDependencies = {
  createAssistantDestination: async (input) => {
    // The database creates and returns a real persisted assistant row; this
    // service never manufactures a message ID or inserts a chat turn itself.
    const client = await authenticatedRpcClient(input.userId);
    const { data, error } = await client.rpc("create_agent_assistant_message_destination", {
      p_request_id: input.requestId,
      p_conversation_id: input.conversationId,
      p_user_message_id: input.userMessageId,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
      throw new RequestMessageBindingError("persistence_failed");
    }
    return data;
  },
  validateBinding: async (input) => {
    const client = await authenticatedRpcClient(input.userId);
    const { data, error } = await client.rpc("validate_agent_request_message_binding", {
      p_request_id: input.requestId,
      p_conversation_id: input.conversationId,
      p_user_message_id: input.userMessageId,
      p_assistant_message_id: input.assistantMessageId,
    });
    if (error) return false;
    return data === true;
  },
  finalizeAssistantMessage: async (input) => {
    const client = await authenticatedRpcClient(input.userId);
    const { data, error } = await client.rpc("finalize_agent_assistant_message", {
      p_request_id: input.requestId,
      p_conversation_id: input.conversationId,
      p_user_message_id: input.userMessageId,
      p_assistant_message_id: input.assistantMessageId,
      p_final_text: input.finalText,
    });
    if (error) {
      const code = typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
      throw new RequestMessageBindingError(code.includes("MESSAGE_FINALIZATION_CONFLICT")
        ? "finalization_conflict"
        : "persistence_failed");
    }
    if (data !== input.assistantMessageId) throw new RequestMessageBindingError("persistence_failed");
  },
};

export function createRequestMessageBindingService(
  dependencies: RequestMessageBindingServiceDependencies = defaultDependencies,
) {
  return Object.freeze({
    async create(seed: RequestMessageBindingSeed): Promise<RequestMessageBinding> {
      if (![seed.requestId, seed.userId, seed.conversationId, seed.userMessageId].every((value) => UUID_PATTERN.test(value))) {
        throw new RequestMessageBindingError("invalid_binding");
      }
      let assistantMessageId: string;
      try {
        assistantMessageId = await dependencies.createAssistantDestination({
          requestId: seed.requestId,
          userId: seed.userId,
          conversationId: seed.conversationId,
          userMessageId: seed.userMessageId,
        });
      } catch (error) {
        if (error instanceof RequestMessageBindingError) throw error;
        throw new RequestMessageBindingError("persistence_failed");
      }
      const parsed = requestMessageBindingSchema.safeParse({ ...seed, assistantMessageId });
      if (!parsed.success) throw new RequestMessageBindingError("invalid_binding");
      let valid = false;
      try {
        valid = await dependencies.validateBinding(parsed.data);
      } catch {
        valid = false;
      }
      if (!valid) throw new RequestMessageBindingError("message_unavailable");
      return Object.freeze(parsed.data);
    },

    async validate(input: unknown): Promise<RequestMessageBinding> {
      const parsed = requestMessageBindingSchema.safeParse(input);
      if (!parsed.success) throw new RequestMessageBindingError("invalid_binding");
      let valid = false;
      try {
        valid = await dependencies.validateBinding(parsed.data);
      } catch {
        valid = false;
      }
      if (!valid) throw new RequestMessageBindingError("message_unavailable");
      return Object.freeze(parsed.data);
    },

    async finalize(input: RequestMessageBinding & { finalText: string }): Promise<void> {
      const { finalText, ...binding } = input;
      const parsed = requestMessageBindingSchema.safeParse(binding);
      if (!parsed.success || typeof finalText !== "string" || !finalText.trim()
        || finalText.length > MAX_FINAL_MESSAGE_LENGTH || finalText.startsWith(PENDING_ASSISTANT_MESSAGE_PREFIX)) {
        throw new RequestMessageBindingError("invalid_binding");
      }
      try {
        await dependencies.finalizeAssistantMessage({ ...parsed.data, finalText });
      } catch (error) {
        if (error instanceof RequestMessageBindingError) throw error;
        throw new RequestMessageBindingError("persistence_failed");
      }
    },
  });
}

export const requestMessageBindingService = createRequestMessageBindingService();

export const requestMessageBindingValidator: RequestMessageBindingValidator = Object.freeze({
  async validate(input: RequestMessageBinding) {
    try {
      await requestMessageBindingService.validate(input);
      return true;
    } catch {
      return false;
    }
  },
});
