import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const SOURCE_ID = "30000000-0000-4000-8000-000000000002";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000003";
const ASSISTANT_MESSAGE_ID = "50000000-0000-4000-8000-000000000001";
const GENERATED_IMAGE_ID = "60000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
  },
  authenticatedClient: null as unknown as {
    auth: { getUser: ReturnType<typeof vi.fn> };
    from: ReturnType<typeof vi.fn>;
  },
  conversationQuery: null as unknown as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  },
  serviceClient: { marker: "service-role" },
  createAdminClient: vi.fn(),
  createDependencies: vi.fn(),
  orchestrateImageEdit: vi.fn(),
  getLastQuotaErrorCode: vi.fn(),
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.authenticatedClient),
}));

vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("../../lib/image-generation/image-edit-server-dependencies", () => ({
  createImageEditServerDependencies: mocks.createDependencies,
}));

vi.mock("../../lib/image-generation/image-edit-orchestrator", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/image-generation/image-edit-orchestrator")
  >("../../lib/image-generation/image-edit-orchestrator");
  return {
    ...actual,
    orchestrateImageEdit: mocks.orchestrateImageEdit,
  };
});

import { POST } from "../../app/api/image-edit/route";
import { ImageEditOrchestrationError } from "../../lib/image-generation/image-edit-orchestrator";

const validBody = {
  conversationId: CONVERSATION_ID,
  sourceReference: {
    kind: "generated_image",
    generatedImageId: SOURCE_ID,
  },
  instruction: "Remove the red mug.",
  idempotencyKey: REQUEST_ID,
};

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/image-edit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function completedResult() {
  return {
    kind: "completed",
    disposition: "claimed",
    status: "completed",
    conversationId: CONVERSATION_ID,
    imageEditRequestId: REQUEST_ID,
    userMessageId: MESSAGE_ID,
    assistantMessageId: ASSISTANT_MESSAGE_ID,
    generatedImageId: GENERATED_IMAGE_ID,
  } as const;
}

describe("POST /api/image-edit", () => {
  beforeEach(() => {
    mocks.auth.getUser.mockReset();
    mocks.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    mocks.conversationQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: { id: CONVERSATION_ID },
        error: null,
      })),
    };
    mocks.conversationQuery.select.mockReturnValue(mocks.conversationQuery);
    mocks.conversationQuery.eq.mockReturnValue(mocks.conversationQuery);
    mocks.authenticatedClient = {
      auth: mocks.auth,
      from: vi.fn(() => mocks.conversationQuery),
    };
    mocks.createAdminClient.mockReset();
    mocks.createAdminClient.mockReturnValue(mocks.serviceClient);
    mocks.getLastQuotaErrorCode.mockReset();
    mocks.getLastQuotaErrorCode.mockReturnValue(null);
    mocks.createDependencies.mockReset();
    mocks.createDependencies.mockReturnValue({
      getLastQuotaErrorCode: mocks.getLastQuotaErrorCode,
    });
    mocks.orchestrateImageEdit.mockReset();
    mocks.orchestrateImageEdit.mockResolvedValue(completedResult());
  });

  it("returns 401 without an authenticated session", async () => {
    mocks.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(request(validBody));

    expect(response.status).toBe(401);
    expect(await bodyOf(response)).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication is required." },
    });
    expect(mocks.orchestrateImageEdit).not.toHaveBeenCalled();
  });

  it("accepts JSON only and rejects malformed or oversized bodies", async () => {
    const contentTypeResponse = await POST(
      request(validBody, { "Content-Type": "text/plain" }),
    );
    expect(contentTypeResponse.status).toBe(415);

    const malformedResponse = await POST(request("{\"conversationId\":"));
    expect(malformedResponse.status).toBe(400);
    expect(await bodyOf(malformedResponse)).toMatchObject({
      error: { code: "INVALID_JSON" },
    });

    const oversizedResponse = await POST(
      request(validBody, { "Content-Length": String(33 * 1024) }),
    );
    expect(oversizedResponse.status).toBe(413);
    expect(mocks.orchestrateImageEdit).not.toHaveBeenCalled();
  });

  it.each([
    ["missing conversationId", { ...validBody, conversationId: undefined }],
    ["bad conversation UUID", { ...validBody, conversationId: "not-a-uuid" }],
    ["missing source", { ...validBody, sourceReference: undefined }],
    [
      "bad generated source UUID",
      { ...validBody, sourceReference: { kind: "generated_image", generatedImageId: "bad" } },
    ],
    [
      "unknown generated source field",
      {
        ...validBody,
        sourceReference: {
          kind: "generated_image",
          generatedImageId: SOURCE_ID,
          storagePath: "generated/secret.png",
        },
      },
    ],
    [
      "bad uploaded source UUID",
      {
        ...validBody,
        sourceReference: { kind: "uploaded_image", messageId: "bad", ordinal: 1 },
      },
    ],
    [
      "zero uploaded ordinal",
      {
        ...validBody,
        sourceReference: { kind: "uploaded_image", messageId: MESSAGE_ID, ordinal: 0 },
      },
    ],
    [
      "negative uploaded ordinal",
      {
        ...validBody,
        sourceReference: { kind: "uploaded_image", messageId: MESSAGE_ID, ordinal: -1 },
      },
    ],
    ["missing instruction", { ...validBody, instruction: undefined }],
    ["whitespace instruction", { ...validBody, instruction: " \n\t" }],
    ["long instruction", { ...validBody, instruction: "x".repeat(4001) }],
    ["invalid idempotency UUID", { ...validBody, idempotencyKey: "bad" }],
    ["null body", null],
    ["array body", [validBody]],
    ["unknown top-level field", { ...validBody, provider: "replicate" }],
    ["client user identity", { ...validBody, userId: USER_ID }],
    ["client authenticated identity", { ...validBody, authenticatedUserId: USER_ID }],
    ["client owner identity", { ...validBody, ownerId: USER_ID }],
    ["client API key", { ...validBody, apiKey: "secret" }],
    ["client model", { ...validBody, model: "other" }],
    ["client Storage path", { ...validBody, storagePath: "generated/secret.png" }],
    ["client dimensions", { ...validBody, width: 1024, height: 1024 }],
    ["client fingerprint", { ...validBody, fingerprint: "a".repeat(64) }],
    [
      "unsafe uploaded ordinal",
      {
        ...validBody,
        sourceReference: {
          kind: "uploaded_image",
          messageId: MESSAGE_ID,
          ordinal: Number.MAX_SAFE_INTEGER + 1,
        },
      },
    ],
  ])("rejects %s before orchestration", async (_label, body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.orchestrateImageEdit).not.toHaveBeenCalled();
  });

  it("returns the same privacy-safe 404 for missing and foreign conversations", async () => {
    const responses: Response[] = [];

    for (const label of ["missing", "foreign"]) {
      mocks.conversationQuery.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      responses.push(await POST(request(validBody)));
      expect(label).toBeTruthy();
    }

    expect(responses[0]?.status).toBe(404);
    expect(responses[1]?.status).toBe(404);
    expect(await responses[1]!.text()).toBe(await responses[0]!.clone().text());
    expect(mocks.orchestrateImageEdit).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a bounded generic error for a conversation preflight failure", async () => {
    mocks.conversationQuery.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "raw conversation SQL details" },
    });

    const response = await POST(request(validBody));
    const serialized = JSON.stringify(await bodyOf(response));

    expect(response.status).toBe(500);
    expect(serialized).toBe(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "The image edit could not be completed.",
        },
      }),
    );
    expect(serialized).not.toContain("raw conversation SQL details");
    expect(mocks.orchestrateImageEdit).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("passes the session user, exact instruction, and logical source to the orchestrator", async () => {
    const instruction = "  Remove the red mug.\nKeep the exact framing.  ";
    await POST(
      request({
        ...validBody,
        instruction,
      }),
    );

    expect(mocks.createDependencies).toHaveBeenCalledWith({
      authenticatedClient: mocks.authenticatedClient,
      serviceClient: mocks.serviceClient,
      authenticatedUserId: USER_ID,
      conversationId: CONVERSATION_ID,
    });
    expect(mocks.orchestrateImageEdit).toHaveBeenCalledWith(
      {
        authenticatedUserId: USER_ID,
        conversationId: CONVERSATION_ID,
        sourceReference: validBody.sourceReference,
        instruction,
        idempotencyKey: REQUEST_ID,
      },
      expect.anything(),
    );
  });

  it("returns safe durable IDs for a new completion", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      status: "completed",
      replayed: false,
      conversationId: CONVERSATION_ID,
      imageEditRequestId: REQUEST_ID,
      userMessageId: MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      generatedImageId: GENERATED_IMAGE_ID,
    });
  });

  it("keeps nonexistent and foreign source failures byte-for-byte equivalent", async () => {
    mocks.orchestrateImageEdit
      .mockRejectedValueOnce(new ImageEditOrchestrationError("source_not_found"))
      .mockRejectedValueOnce(new ImageEditOrchestrationError("source_forbidden"));

    const nonexistent = await POST(request(validBody));
    const foreign = await POST(request(validBody));

    expect(nonexistent.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(await nonexistent.clone().text());
  });

  it("returns replay without performing route-owned provider or Storage work", async () => {
    mocks.orchestrateImageEdit.mockResolvedValue({
      ...completedResult(),
      kind: "completed_replay",
    });

    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toMatchObject({
      status: "completed",
      replayed: true,
    });
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.orchestrateImageEdit).toHaveBeenCalledOnce();
  });

  it("maps in-progress, conflict, and unavailable results", async () => {
    const cases = [
      [
        {
          kind: "in_progress",
          disposition: "in_progress",
          status: "in_progress",
          conversationId: CONVERSATION_ID,
          imageEditRequestId: REQUEST_ID,
        },
        202,
        { status: "in_progress" },
      ],
      [
        {
          kind: "conflict",
          disposition: "conflict",
          status: "failed",
          conversationId: CONVERSATION_ID,
          imageEditRequestId: REQUEST_ID,
        },
        409,
        { error: { code: "IMAGE_EDIT_IDEMPOTENCY_CONFLICT" } },
      ],
      [
        {
          kind: "completed_result_unavailable",
          disposition: "completed",
          status: "completed",
          conversationId: CONVERSATION_ID,
          imageEditRequestId: REQUEST_ID,
          userMessageId: null,
          assistantMessageId: null,
          generatedImageId: null,
        },
        410,
        { error: { code: "IMAGE_EDIT_RESULT_UNAVAILABLE" } },
      ],
    ] as const;

    for (const [result, status, expected] of cases) {
      mocks.orchestrateImageEdit.mockResolvedValueOnce(result);
      const response = await POST(request(validBody));
      expect(response.status).toBe(status);
      expect(await bodyOf(response)).toMatchObject(expected);
    }
  });

  it.each([
    ["IMAGE_DAILY_LIMIT_REACHED"],
    ["IMAGE_MONTHLY_LIMIT_REACHED"],
  ] as const)("preserves %s as an HTTP 429", async (quotaCode) => {
    mocks.getLastQuotaErrorCode.mockReturnValue(quotaCode);
    mocks.orchestrateImageEdit.mockRejectedValue(
      new ImageEditOrchestrationError("quota_exhausted"),
    );

    const response = await POST(request(validBody));

    expect(response.status).toBe(429);
    expect(await bodyOf(response)).toEqual({
      error: {
        code: quotaCode,
        message: "You've reached your image editing limit.",
      },
    });
  });

  it.each([
    ["source_forbidden", 404, "IMAGE_EDIT_SOURCE_UNAVAILABLE"],
    ["source_not_found", 404, "IMAGE_EDIT_SOURCE_UNAVAILABLE"],
    ["invalid_source", 404, "IMAGE_EDIT_SOURCE_UNAVAILABLE"],
    ["provider_timeout", 504, "IMAGE_EDIT_PROVIDER_TIMEOUT"],
    ["provider_failure", 502, "IMAGE_EDIT_PROVIDER_FAILURE"],
    ["invalid_provider_output", 502, "IMAGE_EDIT_INVALID_PROVIDER_OUTPUT"],
    ["provider_configuration", 500, "IMAGE_EDIT_CONFIGURATION"],
    ["storage_failure", 500, "INTERNAL_ERROR"],
    ["persistence_failure", 500, "INTERNAL_ERROR"],
    ["internal_failure", 500, "INTERNAL_ERROR"],
  ] as const)("maps %s to a bounded response", async (code, status, responseCode) => {
    mocks.orchestrateImageEdit.mockRejectedValue(
      new ImageEditOrchestrationError(code),
    );

    const response = await POST(request(validBody));
    expect(response.status).toBe(status);
    const responseBody = await bodyOf(response);
    expect(responseBody).toMatchObject({
      error: { code: responseCode },
    });
    if (code === "provider_failure") {
      expect(responseBody).toEqual({
        error: {
          code: "IMAGE_EDIT_PROVIDER_FAILURE",
          message: "The image edit provider failed.",
        },
      });
    }
  });

  it("does not expose provider, SQL, Storage, fingerprint, or credential data", async () => {
    mocks.orchestrateImageEdit.mockRejectedValue(
      new Error(
        "provider raw body SQL secret generated/unsafe/path fingerprint api-key service-role",
      ),
    );

    const response = await POST(request(validBody));
    const serialized = JSON.stringify(await bodyOf(response));

    expect(response.status).toBe(500);
    expect(serialized).toBe(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "The image edit could not be completed.",
        },
      }),
    );
  });
});
