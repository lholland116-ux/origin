import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiRequestTelemetryRecord } from "@/lib/ai/request-telemetry";

const mocks = vi.hoisted(() => ({
  abortSignal: vi.fn(),
  createAdminClient: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import {
  AI_REQUEST_TELEMETRY_WRITE_TIMEOUT_MS,
  writeAiRequestTelemetry,
} from "@/lib/ai/request-telemetry-writer";

const SAFE_EVENT = "[ai_request_telemetry] write_skipped";

function record(
  overrides: Partial<AiRequestTelemetryRecord> = {},
): AiRequestTelemetryRecord {
  return {
    route: "standard",
    attemptKind: "primary",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    plan: "pro",
    outcome: "success",
    latencyMs: 125,
    hadImage: true,
    inputTokens: 100,
    cachedInputTokens: 25,
    outputTokens: 75,
    reasoningTokens: 50,
    totalTokens: 175,
    ...overrides,
  };
}

function configureInsert(result: Promise<unknown> = Promise.resolve({ error: null })) {
  mocks.abortSignal.mockReturnValue(result);
  mocks.insert.mockReturnValue({ abortSignal: mocks.abortSignal });
  mocks.from.mockReturnValue({ insert: mocks.insert });
  mocks.createAdminClient.mockReturnValue({ from: mocks.from });
}

function warningText(warn: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(warn.mock.calls);
}

describe("writeAiRequestTelemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes one exact snake_case payload without warning or mutating the input", async () => {
    configureInsert();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const input = Object.freeze(record());

    await expect(writeAiRequestTelemetry(input)).resolves.toBeUndefined();

    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("ai_request_telemetry");
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledWith({
      route: "standard",
      attempt_kind: "primary",
      model: "gpt-5.6-luna",
      reasoning_effort: "high",
      plan: "pro",
      outcome: "success",
      latency_ms: 125,
      had_image: true,
      input_tokens: 100,
      cached_input_tokens: 25,
      output_tokens: 75,
      reasoning_tokens: 50,
      total_tokens: 175,
    });
    expect(mocks.insert.mock.calls[0]?.[0]).not.toHaveProperty("id");
    expect(mocks.insert.mock.calls[0]?.[0]).not.toHaveProperty("occurred_at");
    expect(input).toEqual(record());
    expect(warn).not.toHaveBeenCalled();
  });

  it("preserves nullable token fields and the CS5A provider effort domain", async () => {
    for (const reasoningEffort of ["none", "xhigh", "max"] as const) {
      configureInsert();
      await expect(
        writeAiRequestTelemetry(
          record({
            reasoningEffort,
            inputTokens: null,
            cachedInputTokens: null,
            outputTokens: null,
            reasoningTokens: null,
            totalTokens: null,
          }),
        ),
      ).resolves.toBeUndefined();

      expect(mocks.insert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          reasoning_effort: reasoningEffort,
          input_tokens: null,
          cached_input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
          total_tokens: null,
        }),
      );
    }
  });

  it("clears the deadline after an insert completes before timeout", async () => {
    vi.useFakeTimers();
    configureInsert();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(writeAiRequestTelemetry(record())).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TELEMETRY_WRITE_TIMEOUT_MS);

    expect((mocks.abortSignal.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("swallows returned database errors and logs only the fixed safe reason", async () => {
    const rawError = { message: "database details containing model and token 175" };
    configureInsert(Promise.resolve({ error: rawError }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(writeAiRequestTelemetry(record())).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith(SAFE_EVENT, {
      reason: "database_error",
    });
    expect(warningText(warn)).not.toContain(rawError.message);
    expect(warningText(warn)).not.toContain("gpt-5.6-luna");
    expect(warningText(warn)).not.toContain("standard");
    expect(warningText(warn)).not.toContain("pro");
    expect(warningText(warn)).not.toContain("175");
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("swallows unavailable admin-client configuration without exposing it", async () => {
    const unavailable = new Error("missing service-role secret");
    mocks.createAdminClient.mockImplementation(() => {
      throw unavailable;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(writeAiRequestTelemetry(record())).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith(SAFE_EVENT, {
      reason: "admin_client_unavailable",
    });
    expect(warningText(warn)).not.toContain(unavailable.message);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("aborts and resolves at the bounded timeout when the insert never settles", async () => {
    vi.useFakeTimers();
    configureInsert(new Promise(() => undefined));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const writer = writeAiRequestTelemetry(record());
    let settled = false;
    void writer.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(AI_REQUEST_TELEMETRY_WRITE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(writer).resolves.toBeUndefined();

    expect((mocks.abortSignal.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith(SAFE_EVENT, { reason: "timeout" });
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("swallows rejected inserts without exposing their rejection", async () => {
    const rejection = new Error("private database failure");
    configureInsert(Promise.reject(rejection));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(writeAiRequestTelemetry(record())).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith(SAFE_EVENT, {
      reason: "unexpected_error",
    });
    expect(warningText(warn)).not.toContain(rejection.message);
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("absorbs a late rejection after timeout without a second warning", async () => {
    vi.useFakeTimers();
    let rejectInsert!: (reason: unknown) => void;
    const pending = new Promise<unknown>((_resolve, reject) => {
      rejectInsert = reject;
    });
    configureInsert(pending);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const writer = writeAiRequestTelemetry(record());
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TELEMETRY_WRITE_TIMEOUT_MS);
    await expect(writer).resolves.toBeUndefined();

    rejectInsert(new Error("late private failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledExactlyOnceWith(SAFE_EVENT, { reason: "timeout" });
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("isolates failures from the safe logger", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("configuration unavailable");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logger unavailable");
    });

    await expect(writeAiRequestTelemetry(record())).resolves.toBeUndefined();
  });

  it("swallows malformed runtime input that throws while creating the payload", async () => {
    configureInsert();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const malformed = {} as AiRequestTelemetryRecord;
    Object.defineProperty(malformed, "route", {
      get() {
        throw new Error("private malformed input detail");
      },
    });

    await expect(writeAiRequestTelemetry(malformed)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledExactlyOnceWith(SAFE_EVENT, {
      reason: "unexpected_error",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
