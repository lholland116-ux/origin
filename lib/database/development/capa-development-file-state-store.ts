import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import {
  CapaDevelopmentStateSnapshotError,
  validateCapaDevelopmentStateSnapshot,
  type CapaDevelopmentStateMapEntry,
  type CapaDevelopmentStateSnapshot,
} from "./capa-development-state-snapshot";

export interface CapaDevelopmentFileStateStoreOptions {
  readonly state_path: string;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function sortedEntries<Value>(entries: readonly CapaDevelopmentStateMapEntry<Value>[]): readonly CapaDevelopmentStateMapEntry<Value>[] {
  return entries.map(([key, value]) => [key, value] as const).sort(([left], [right]) => left.localeCompare(right));
}

function deterministicSnapshot(snapshot: CapaDevelopmentStateSnapshot): CapaDevelopmentStateSnapshot {
  return {
    ...snapshot,
    cases: sortedEntries(snapshot.cases),
    case_numbers: sortedEntries(snapshot.case_numbers),
    case_number_counters: sortedEntries(snapshot.case_number_counters),
    case_versions: sortedEntries(snapshot.case_versions),
    section_versions: sortedEntries(snapshot.section_versions),
    audit_events: sortedEntries(snapshot.audit_events),
    creation_idempotency: sortedEntries(snapshot.creation_idempotency),
    workflow_idempotency: sortedEntries(snapshot.workflow_idempotency),
    advisory_outputs: sortedEntries(snapshot.advisory_outputs),
    advisory_runs: sortedEntries(snapshot.advisory_runs),
    investigation_planning_adoptions: sortedEntries(snapshot.investigation_planning_adoptions),
  };
}

export class CapaDevelopmentFileStateStore {
  readonly state_path: string;

  constructor(options: CapaDevelopmentFileStateStoreOptions) {
    if (!options.state_path || options.state_path.trim() !== options.state_path) {
      throw new Error("A CAPA development persistence state path is required.");
    }
    this.state_path = options.state_path;
  }

  async load(): Promise<CapaDevelopmentStateSnapshot | null> {
    let source: string;
    try {
      source = await readFile(this.state_path, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new CapaDevelopmentStateSnapshotError("INVALID_SNAPSHOT", "The CAPA development persistence state file contains invalid JSON.");
    }
    return validateCapaDevelopmentStateSnapshot(parsed);
  }

  loadSync(): CapaDevelopmentStateSnapshot | null {
    let source: string;
    try {
      source = readFileSync(this.state_path, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new CapaDevelopmentStateSnapshotError("INVALID_SNAPSHOT", "The CAPA development persistence state file contains invalid JSON.");
    }
    return validateCapaDevelopmentStateSnapshot(parsed);
  }

  async save(snapshot: CapaDevelopmentStateSnapshot): Promise<void> {
    const validated = validateCapaDevelopmentStateSnapshot(snapshot);
    const serialized = `${JSON.stringify(deterministicSnapshot(validated), null, 2)}\n`;
    const directory = dirname(this.state_path);
    await mkdir(directory, { recursive: true });
    const temporaryPath = join(directory, `.${basename(this.state_path)}.${process.pid}.${randomUUID()}.tmp`);
    let renamed = false;
    try {
      await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
      const handle = await open(temporaryPath, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, this.state_path);
      renamed = true;
    } finally {
      if (!renamed) await unlink(temporaryPath).catch(() => undefined);
    }
  }
}
