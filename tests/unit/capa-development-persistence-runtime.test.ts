import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CapaDevelopmentRuntimeDisabledError,
  CapaDevelopmentRuntimePersistenceConfigurationError,
  createCapaDevelopmentRuntime,
  getCapaDevelopmentRuntime,
  resolveCapaDevelopmentPersistencePath,
} from "../../lib/capa/application/capa-development-runtime";
import { CapaDevelopmentFileStateStore } from "../../lib/database/development/capa-development-file-state-store";
import type { CorrelationId, IdempotencyKey, RequestId, RequestTrace } from "../../lib/capa/domain/capa-types";
import type { TransactionId } from "../../lib/database/transactions";

const directories: string[] = [];
const trace: RequestTrace = {
  request_id: "10000000-0000-4000-8000-000000000001" as RequestId,
  correlation_id: "20000000-0000-4000-8000-000000000001" as CorrelationId,
  idempotency_key: "persistence-test" as IdempotencyKey,
};

function globalRuntime(): typeof globalThis & { __lvt_capa_development_runtime__?: unknown } {
  return globalThis as typeof globalThis & { __lvt_capa_development_runtime__?: unknown };
}

afterEach(async () => {
  delete globalRuntime().__lvt_capa_development_runtime__;
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("development CAPA file persistence", () => {
  it("preserves default, relative, and absolute persistence paths", () => {
    expect(resolveCapaDevelopmentPersistencePath(undefined)).toBe(
      join(process.cwd(), ".local/capa-development-state.json"),
    );
    expect(resolveCapaDevelopmentPersistencePath("custom/state.json")).toBe(
      join(process.cwd(), "custom/state.json"),
    );

    const absolutePath = join(tmpdir(), "absolute-state.json");
    expect(resolveCapaDevelopmentPersistencePath(absolutePath)).toBe(absolutePath);
  });

  it("keeps ordinary factory runtimes isolated and nonpersistent by default", () => {
    const first = createCapaDevelopmentRuntime({ environment: "test" });
    const second = createCapaDevelopmentRuntime({ environment: "test" });
    expect(first.database).not.toBe(second.database);
    expect(first.database.exportSnapshot().revision).toBe(0);
    expect(second.database.exportSnapshot().revision).toBe(0);
  });

  it("persists a successful transaction and hydrates a fresh runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capa-runtime-persistence-"));
    directories.push(directory);
    const store = new CapaDevelopmentFileStateStore({ state_path: join(directory, "state.json") });
    const first = createCapaDevelopmentRuntime({
      environment: "test", now: () => new Date("2026-09-03T00:00:00.000Z"),
      generate_uuid: () => "30000000-0000-4000-8000-000000000001",
      persistence: { state_store: store },
    });
    await first.database.runInTransaction(trace, async () => "saved");
    const second = createCapaDevelopmentRuntime({
      environment: "test", now: () => new Date("2026-09-03T00:00:00.000Z"),
      generate_uuid: () => "40000000-0000-4000-8000-000000000001",
      persistence: { state_store: store },
    });
    expect(second.database.exportSnapshot().revision).toBe(1);
  });

  it("hydrates environment-enabled shared runtime state and rejects invalid configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capa-runtime-env-"));
    directories.push(directory);
    const store = new CapaDevelopmentFileStateStore({ state_path: join(directory, "state.json") });
    await store.save(createCapaDevelopmentRuntime({ environment: "test" }).database.exportSnapshot());
    vi.stubEnv("CAPA_DEVELOPMENT_PERSISTENCE_ENABLED", "true");
    vi.stubEnv("CAPA_DEVELOPMENT_PERSISTENCE_PATH", join(directory, "state.json"));
    const runtime = getCapaDevelopmentRuntime();
    expect(runtime.database.exportSnapshot().revision).toBe(0);

    delete globalRuntime().__lvt_capa_development_runtime__;
    vi.stubEnv("CAPA_DEVELOPMENT_PERSISTENCE_ENABLED", "maybe");
    expect(() => getCapaDevelopmentRuntime()).toThrow(CapaDevelopmentRuntimePersistenceConfigurationError);
  });

  it("never enables local persistence in production", () => {
    expect(() => createCapaDevelopmentRuntime({ environment: "production", persistence: {
      state_store: new CapaDevelopmentFileStateStore({ state_path: ".local/blocked.json" }),
    } })).toThrow(CapaDevelopmentRuntimeDisabledError);
  });
});
