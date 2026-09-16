import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildQualificationEditOutput,
  buildQualificationEditRequest,
  validateQualificationArtifactPath,
  validatePositiveBudgetUsd,
} from "../../scripts/qualification/image-editing/live/contracts.mjs";
import {
  QUALIFICATION_CREDENTIAL_ENV,
  credentialEnvForProvider,
  resolveQualificationCredential,
} from "../../scripts/qualification/image-editing/live/credentials.mjs";

type Fixture = {
  sourceId: string;
  intendedFilename: string;
  expectedMimeType: string;
  expectedWidth: number;
  expectedHeight: number;
  fixtureVersion: string;
  label: string;
  visualRequirements: string[];
  provenance: string;
  licenseStatus: string;
  synthetic: boolean;
  sensitive: boolean;
  status: string;
  actualSha256: string | null;
  actualMimeType: string | null;
  actualWidth: number | null;
  actualHeight: number | null;
};

type Mapping = {
  candidateId: string;
  provider: string;
  modelRef: string;
  credentialEnv: string;
  transportMetadata: Record<string, unknown>;
};

const repositoryRoot = resolve(__dirname, "../..");
const qualificationRoot = join(repositoryRoot, "scripts/qualification/image-editing");
const runnerPath = join(qualificationRoot, "run.mjs");

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(qualificationRoot, fileName), "utf8")) as T;
}

function runRunner(argumentsList: string[]) {
  return spawnSync(process.execPath, [runnerPath, ...argumentsList], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function expectRejected(argumentsList: string[], expectedMessage?: string) {
  const result = runRunner(argumentsList);
  expect(result.status).not.toBe(0);
  if (expectedMessage) expect(`${result.stdout}${result.stderr}`).toContain(expectedMessage);
  return result;
}

const requiredVisualRequirements = [
  "one synthetic adult human subject",
  "clearly visible face",
  "clearly visible hair",
  "olive-green cotton jacket",
  "visible shirt beneath jacket",
  "small red ceramic mug",
  "table",
  "visible hands",
  "clearly separable background",
  "sufficient empty usable table area for sequential scarf addition",
  "stable lighting",
];

describe("M9-CS4B-1 qualification contracts and live safety", () => {
  it("defines exactly five pending synthetic PNG fixtures in deterministic order", () => {
    const manifest = readJson<{ schemaVersion: string; fixtures: Fixture[] }>("fixtures/manifest.json");

    expect(manifest.schemaVersion).toBe("lvtchat-image-edit-qualification-fixture-manifest-1.0.0");
    expect(manifest.fixtures).toHaveLength(5);
    expect(manifest.fixtures.map((fixture) => fixture.sourceId)).toEqual([
      "source-01",
      "source-02",
      "source-03",
      "source-04",
      "source-05",
    ]);

    manifest.fixtures.forEach((fixture, index) => {
      expect(fixture.intendedFilename).toBe(`source-0${index + 1}.png`);
      expect(fixture.expectedMimeType).toBe("image/png");
      expect(fixture.expectedWidth).toBe(1024);
      expect(fixture.expectedHeight).toBe(1024);
      expect(fixture.fixtureVersion).toBe("cs4b-1.0.0");
      expect(fixture.synthetic).toBe(true);
      expect(fixture.sensitive).toBe(false);
      expect(fixture.status).toBe("pending");
      expect(fixture.actualSha256).toBeNull();
      expect(fixture.actualMimeType).toBeNull();
      expect(fixture.actualWidth).toBeNull();
      expect(fixture.actualHeight).toBeNull();
      for (const requirement of requiredVisualRequirements) {
        expect(fixture.visualRequirements).toContain(requirement);
      }
    });
  });

  it("keeps the exact approved composition requirement on every fixture", () => {
    const manifest = readJson<{ fixtures: Fixture[] }>("fixtures/manifest.json");
    const labels = manifest.fixtures.map((fixture) => fixture.label);

    expect(labels).toEqual([
      "Synthetic indoor kitchen/workbench source",
      "Synthetic outdoor cafe/patio source",
      "Synthetic living-room/editorial source",
      "Synthetic studio/workshop source",
      "Synthetic porch/garden source",
    ]);
    expect(manifest.fixtures[0].visualRequirements).toContain("surrounding shelves or structured background detail");
    expect(manifest.fixtures[1].visualRequirements).toContain("stronger natural shadows");
    expect(manifest.fixtures[2].visualRequirements).toContain("textile and wood texture variation");
    expect(manifest.fixtures[3].visualRequirements).toContain("high-contrast subject edges");
    expect(manifest.fixtures[4].visualRequirements).toContain("golden-hour style lighting");
  });

  it("resolves only dedicated provider credentials", () => {
    expect(QUALIFICATION_CREDENTIAL_ENV).toEqual({
      runware: "RUNWARE_QUAL_API_KEY",
      replicate: "REPLICATE_QUAL_API_TOKEN",
    });
    expect(credentialEnvForProvider("runware")).toBe("RUNWARE_QUAL_API_KEY");
    expect(credentialEnvForProvider("replicate")).toBe("REPLICATE_QUAL_API_TOKEN");
    expect(resolveQualificationCredential("runware", { RUNWARE_QUAL_API_KEY: "runware-secret" })).toBe("runware-secret");
    expect(resolveQualificationCredential("replicate", { REPLICATE_QUAL_API_TOKEN: "replicate-secret" })).toBe("replicate-secret");
  });

  it("fails closed for missing, blank, production-style, and cross-provider credentials", () => {
    const cases = [
      ["runware", {}],
      ["replicate", { REPLICATE_QUAL_API_TOKEN: " " }],
      ["replicate", { REPLICATE_API_TOKEN: "production-token" }],
      ["runware", { RUNWARE_API_KEY: "production-key" }],
      ["runware", { FAL_QUAL_API_KEY: "other-provider-key" }],
      ["replicate", { FAL_QUAL_API_KEY: "other-provider-key" }],
    ] as const;

    for (const [provider, environment] of cases) {
      expect(() => resolveQualificationCredential(provider, environment)).toThrow();
    }
    expect(() => credentialEnvForProvider("fal")).toThrow("unsupported qualification provider");
    expect(() => credentialEnvForProvider("unknown")).toThrow("unsupported qualification provider");
    expect(() => resolveQualificationCredential("replicate", { REPLICATE_QUAL_API_TOKEN: "secret-token" })).not.toThrow();
    try {
      resolveQualificationCredential("replicate", {});
    } catch (error) {
      expect(String(error)).not.toContain("secret-token");
    }
  });

  it("contains exactly three fixed candidate mappings without secrets or executable endpoints", () => {
    const mappings = readJson<{ mappings: Mapping[] }>("live/mappings.json").mappings;
    expect(mappings).toHaveLength(3);
    expect(mappings.map((mapping) => mapping.candidateId)).toEqual([
      "runware-flux2-klein-4b",
      "runware-qwen-image-edit-2511",
      "replicate-flux1-kontext-dev",
    ]);
    expect(mappings.map(({ candidateId, provider, modelRef, credentialEnv }) => ({ candidateId, provider, modelRef, credentialEnv }))).toEqual([
      {
        candidateId: "runware-flux2-klein-4b",
        provider: "runware",
        modelRef: "runware:400@4",
        credentialEnv: "RUNWARE_QUAL_API_KEY",
      },
      {
        candidateId: "runware-qwen-image-edit-2511",
        provider: "runware",
        modelRef: "alibaba:qwen-image-edit@2511",
        credentialEnv: "RUNWARE_QUAL_API_KEY",
      },
      {
        candidateId: "replicate-flux1-kontext-dev",
        provider: "replicate",
        modelRef: "black-forest-labs/flux-kontext-dev",
        credentialEnv: "REPLICATE_QUAL_API_TOKEN",
      },
    ]);
    expect(JSON.stringify(mappings)).not.toMatch(/production-secret|production-token|production-key/i);
    expect(mappings.every((mapping) => !Object.keys(mapping).some((key) => /secret|api[_-]?key|token/i.test(key)))).toBe(true);
    expect(mappings.every((mapping) => !Object.hasOwn(mapping, "endpoint"))).toBe(true);
    expect(mappings.every((mapping) => typeof mapping.transportMetadata === "object")).toBe(true);
  });

  it("validates normalized request and response contracts without production references", () => {
    const request = buildQualificationEditRequest({
      candidateId: "runware-flux2-klein-4b",
      provider: "runware",
      modelRef: "runware:400@4",
      sourceId: "source-01",
      invocationId: "invocation-01",
      taskId: "task-01-object-removal",
      sequenceId: "sequence-01",
      sequenceStep: 1,
      sourceBytes: new Uint8Array([137, 80, 78, 71]),
      sourceMimeType: "image/png",
      instruction: "Remove the mug.",
      runId: "cs4b-contract",
      authorizedBudgetUsd: "0.10",
    });
    expect(request.sourceBytes).not.toBeInstanceOf(Array);
    expect(request.sourceBytes).toEqual(new Uint8Array([137, 80, 78, 71]));

    const output = buildQualificationEditOutput({
      provider: "runware",
      candidateId: "runware-flux2-klein-4b",
      modelRef: "runware:400@4",
      providerRequestId: null,
      outputBytes: new Uint8Array([137, 80, 78, 71]),
      outputMimeType: "image/png",
      startedAt: "2026-09-16T12:00:00.000Z",
      endedAt: "2026-09-16T12:00:01.000Z",
      latencyMs: 1000,
      providerCost: null,
      providerCostCurrency: null,
      providerCostSource: "not_reported",
      estimatedCost: null,
      estimatedCostSource: null,
      sanitizedProviderMetadata: { requestType: "qualification" },
      failureCode: null,
      failureMessage: null,
    });
    expect(output.outputBytes).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(() => buildQualificationEditRequest({
      candidateId: "runware-flux2-klein-4b",
      provider: "runware",
      modelRef: "generated/original",
      sourceId: "source-01",
      invocationId: "invocation-01",
      taskId: "task-01-object-removal",
      sequenceId: "sequence-01",
      sequenceStep: 1,
      sourceBytes: new Uint8Array([1]),
      sourceMimeType: "image/png",
      instruction: "Remove the mug.",
      runId: "cs4b-contract",
      authorizedBudgetUsd: 0.1,
    })).toThrow("production reference");
  });

  it("rejects non-positive, non-finite, and malformed budgets", () => {
    expect(validatePositiveBudgetUsd("0.10")).toBe(0.1);
    expect(validatePositiveBudgetUsd(1)).toBe(1);
    for (const value of ["0", "-1", "NaN", "Infinity", "", "not-a-number", 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validatePositiveBudgetUsd(value)).toThrow();
    }
  });

  it("confines future raw and output artifacts to the qualification run root", () => {
    expect(validateQualificationArtifactPath("raw/invocation-01.json")).toBe("raw/invocation-01.json");
    expect(validateQualificationArtifactPath("outputs/invocation-01.png")).toBe("outputs/invocation-01.png");
    for (const pathValue of ["../escape.json", "..\\escape.json", "/absolute.json", "C:/absolute.json", "generated/original.png", ".local/other-run/result.json"]) {
      expect(() => validateQualificationArtifactPath(pathValue)).toThrow();
    }
  });

  it("requires every deliberate live smoke selector and rejects arbitrary selectors", () => {
    expectRejected(["--live"]);
    expectRejected(["--live", "--candidate", "runware-flux2-klein-4b"]);
    expectRejected(["--live", "--candidate", "runware-flux2-klein-4b", "--source", "source-01"]);
    expectRejected(["--live", "--candidate", "runware-flux2-klein-4b", "--source", "source-01", "--task", "task-01-object-removal"]);
    expectRejected(["--live", "--candidate", "runware-flux2-klein-4b", "--source", "source-01", "--task", "task-01-object-removal", "--max-spend-usd", "0.10"]);
    expectRejected(["--live", "--candidate", "unapproved", "--source", "source-01", "--task", "task-01-object-removal", "--confirm-paid-qualification", "--max-spend-usd", "0.10"]);
    expectRejected(["--live", "--candidate", "fal-flux2-flash-edit", "--source", "source-01", "--task", "task-01-object-removal", "--confirm-paid-qualification", "--max-spend-usd", "0.10"]);
    expectRejected(["--live", "--candidate", "runware-flux2-klein-4b", "--source", "unknown", "--task", "task-01-object-removal", "--confirm-paid-qualification", "--max-spend-usd", "0.10"]);
    expectRejected(["--live", "--candidate", "runware-flux2-klein-4b", "--source", "source-01", "--task", "unknown", "--confirm-paid-qualification", "--max-spend-usd", "0.10"]);
    expectRejected(["--live", "--candidate", "runware-flux2-klein-4b", "--source", "source-01", "--task", "task-01-object-removal", "--confirm-paid-qualification", "--max-spend-usd", "0"]);
    expectRejected(["--full-bakeoff"]);
  });

  it("rejects arbitrary endpoint/model flags and fails closed for the valid smoke selector", () => {
    expectRejected(["--endpoint", "https://example.test"]);
    expectRejected(["--model", "arbitrary-model"]);

    const runId = "cs4b-live-gate-test";
    const resultPath = join(repositoryRoot, ".local/qualification/image-editing", runId, "result.json");
    const existedBefore = existsSync(resultPath);
    const result = expectRejected([
      "--live",
      "--candidate",
      "runware-flux2-klein-4b",
      "--source",
      "source-01",
      "--task",
      "task-01-object-removal",
      "--confirm-paid-qualification",
      "--max-spend-usd",
      "0.10",
      "--run-id",
      runId,
    ], "LIVE_QUALIFICATION_NOT_IMPLEMENTED");
    expect(result.stdout).not.toContain("dry-run result");
    expect(existsSync(resultPath)).toBe(existedBefore);
  });

  it("keeps the runner free of network, provider, database, and production execution paths", () => {
    const runnerSource = readFileSync(runnerPath, "utf8");
    const contractsSource = readFileSync(join(qualificationRoot, "live/contracts.mjs"), "utf8");
    const credentialsSource = readFileSync(join(qualificationRoot, "live/credentials.mjs"), "utf8");

    expect(runnerSource).not.toMatch(/\bhttps?:\/\//i);
    for (const source of [runnerSource, contractsSource, credentialsSource]) {
      expect(source).not.toContain("fetch(");
      expect(source).not.toMatch(/from\s+["'][^"']*(?:app\/|supabase|provider)/i);
      expect(source).not.toContain("child_process");
      expect(source).not.toContain("import(");
      expect(source).not.toContain("process.env");
    }
    expect(runnerSource).toContain("LIVE_QUALIFICATION_NOT_IMPLEMENTED");
    expect(runnerSource).toContain("production generated-image namespace is not allowed");
    expect(runnerSource).toContain('join(REPOSITORY_ROOT, ".local", "qualification", "image-editing")');
    expect(contractsSource).toContain("production reference");
  });
});
