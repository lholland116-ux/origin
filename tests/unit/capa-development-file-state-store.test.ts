import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapaDevelopmentFileStateStore } from "../../lib/database/development/capa-development-file-state-store";
import { InMemoryCapaDatabase } from "../../lib/database/in-memory/in-memory-capa-database";
import type { TransactionId } from "../../lib/database/transactions";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "capa-development-state-"));
  directories.push(directory);
  return directory;
}

function snapshot() {
  return new InMemoryCapaDatabase({
    generate_transaction_id: () => "snapshot-test" as TransactionId,
    now: () => new Date("2026-09-03T00:00:00.000Z"),
  }).exportSnapshot();
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Capa development file state store", () => {
  it("returns no snapshot for a missing file and creates parent directories", async () => {
    const directory = await temporaryDirectory();
    const statePath = join(directory, "nested", "state.json");
    const store = new CapaDevelopmentFileStateStore({ state_path: statePath });
    expect(await store.load()).toBeNull();
    await store.save(snapshot());
    expect(await store.load()).toEqual(snapshot());
  });

  it("writes deterministic valid JSON and atomically replaces the prior snapshot", async () => {
    const directory = await temporaryDirectory();
    const statePath = join(directory, "state.json");
    const store = new CapaDevelopmentFileStateStore({ state_path: statePath });
    const first = snapshot();
    const second = { ...first, revision: 7 };
    await store.save(first);
    await store.save(second);
    expect(await store.load()).toEqual(second);
    expect((await readFile(statePath, "utf8")).endsWith("\n")).toBe(true);
  });

  it("fails closed for invalid JSON and invalid snapshots", async () => {
    const directory = await temporaryDirectory();
    const statePath = join(directory, "state.json");
    const store = new CapaDevelopmentFileStateStore({ state_path: statePath });
    await writeFile(statePath, "not-json", "utf8");
    await expect(store.load()).rejects.toThrow("invalid JSON");
    const unsupported = snapshot();
    await writeFile(statePath, JSON.stringify({ ...unsupported, schema_version: "wrong" }), "utf8");
    await expect(store.load()).rejects.toThrow("schema version");
  });

  it("does not synthesize secrets or environment values into snapshots", async () => {
    const directory = await temporaryDirectory();
    const statePath = join(directory, "state.json");
    const store = new CapaDevelopmentFileStateStore({ state_path: statePath });
    await store.save(snapshot());
    const source = await readFile(statePath, "utf8");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("CAPA_DEVELOPMENT_PERSISTENCE_ENABLED");
  });
});
