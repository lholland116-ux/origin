import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ensureSafeFixturePath,
  ensureSafeRunId,
  validateMatrix,
} from "../../scripts/qualification/image-editing/run.mjs";
import { describe, expect, it } from "vitest";

type Candidate = {
  candidateId: string;
  provider: string;
  displayName: string;
  declaredModelRef: string;
};

type MatrixStep = {
  sequenceStep: number;
  source: "original" | "prior_step_output";
  instruction: string;
};

type MatrixTask = {
  taskId: string;
  category: string;
  invocationCount: number;
  instruction?: string;
  steps?: MatrixStep[];
};

type Matrix = {
  sources: Array<{ sourceId: string }>;
  tasks: MatrixTask[];
};

type SequenceStep = {
  sequenceStep: number;
  source: "original" | "prior_step_output";
  instructionReference: string;
};

type QualificationScenario = {
  scenarioId: string;
  candidateId: string;
  sourceId: string;
  taskId: string;
  instructionReference: string;
  sequenceSteps: SequenceStep[];
};

type QualificationInvocation = {
  invocationId: string;
  scenarioId: string;
  sequenceId: string | null;
  sequenceStep: number;
  sourceArtifactReference: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  providerCost: number | null;
  providerCostCurrency: string | null;
  providerCostSource: string | null;
  outputArtifactReference: string | null;
  rawOutputArtifactReference: string | null;
  outputSha256: string | null;
  failureCode: string | null;
  failureNotes: string | null;
};

type QualificationResult = {
  runId: string;
  status: string;
  expectedScenarioCount: number;
  expectedInvocationCount: number;
  completedScenarioCount: number;
  completedInvocationCount: number;
  resultFile: string;
  rawOutputDirectory: string;
  scenarios: QualificationScenario[];
  invocations: QualificationInvocation[];
};

const repositoryRoot = resolve(__dirname, "../..");
const qualificationRoot = join(repositoryRoot, "scripts/qualification/image-editing");
const runnerPath = join(qualificationRoot, "run.mjs");

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(qualificationRoot, fileName), "utf8")) as T;
}

function runDryRun(runId: string) {
  execFileSync(process.execPath, [runnerPath, "--dry-run", "--run-id", runId], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  return JSON.parse(
    readFileSync(join(repositoryRoot, ".local/qualification/image-editing", runId, "result.json"), "utf8"),
  ) as QualificationResult;
}

function expectRejected(argumentsList: string[]) {
  expect(() =>
    execFileSync(process.execPath, [runnerPath, ...argumentsList], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: "pipe",
    }),
  ).toThrow();
}

describe("M9-CS4A image-editing qualification harness", () => {
  const candidates = readJson<{ candidates: Candidate[] }>("candidates.json").candidates;
  const matrix = readJson<Matrix>("matrix.json");
  const runnerSource = readFileSync(runnerPath, "utf8");

  it("contains exactly the approved candidates in deterministic order without secrets", () => {
    expect(candidates).toEqual([
      {
        candidateId: "runware-flux2-klein-4b",
        provider: "runware",
        displayName: "FLUX.2 [klein] 4B",
        declaredModelRef: "runware:400@4",
      },
      {
        candidateId: "runware-qwen-image-edit-2511",
        provider: "runware",
        displayName: "Qwen-Image-Edit-2511",
        declaredModelRef: "alibaba:qwen-image-edit@2511",
      },
      {
        candidateId: "fal-flux2-flash-edit",
        provider: "fal",
        displayName: "FLUX.2 Flash Edit",
        declaredModelRef: "fal-ai/flux-2/flash/edit",
      },
      {
        candidateId: "replicate-flux1-kontext-dev",
        provider: "replicate",
        displayName: "FLUX.1 Kontext Dev",
        declaredModelRef: "black-forest-labs/flux-kontext-dev",
      },
    ]);

    for (const candidate of candidates) {
      expect(Object.keys(candidate).sort()).toEqual([
        "candidateId",
        "declaredModelRef",
        "displayName",
        "provider",
      ]);
    }
  });

  it("contains five sources and six ordered tasks with explicit sequential steps", () => {
    expect(matrix.sources.map((source) => source.sourceId)).toEqual([
      "source-01",
      "source-02",
      "source-03",
      "source-04",
      "source-05",
    ]);
    expect(matrix.sources).toHaveLength(5);
    const expectedTasks: MatrixTask[] = [
      {
        taskId: "task-01-object-removal",
        category: "object_removal",
        invocationCount: 1,
        instruction: "Remove the small red ceramic mug from the table while preserving the table, hands, lighting, and all other scene content.",
      },
      {
        taskId: "task-02-localized-add-replace",
        category: "localized_object_add_replace",
        invocationCount: 1,
        instruction: "Replace the small red ceramic mug with a matte blue ceramic mug in the same position; preserve the surrounding scene.",
      },
      {
        taskId: "task-03-color-material-change",
        category: "color_material_change",
        invocationCount: 1,
        instruction: "Change the subject's jacket from olive green cotton to deep navy denim; preserve the subject, pose, fit, and background.",
      },
      {
        taskId: "task-04-background-environment",
        category: "background_environment",
        invocationCount: 1,
        instruction: "Replace only the background with a quiet coastal meadow at golden hour; preserve the foreground subject and its edges.",
      },
      {
        taskId: "task-05-identity-preserving-edit",
        category: "identity_preserving_subject_clothing",
        invocationCount: 1,
        instruction: "Change the subject's shirt to a white linen shirt while preserving the person's face, hair, identity, pose, and lighting.",
      },
      {
        taskId: "task-06-sequential-stability",
        category: "sequential_multi_edit_stability",
        invocationCount: 3,
        steps: [
          {
            sequenceStep: 1,
            source: "original",
            instruction: "Remove the small red ceramic mug from the table; preserve the rest of the scene.",
          },
          {
            sequenceStep: 2,
            source: "prior_step_output",
            instruction: "Add a folded yellow scarf to the cleared area on the table; preserve all existing subjects and scene details.",
          },
          {
            sequenceStep: 3,
            source: "prior_step_output",
            instruction: "Change the scarf material from cotton to textured wool while keeping its position and color; preserve the rest of the scene.",
          },
        ],
      },
    ];
    expect(matrix.tasks).toEqual(expectedTasks);
    expect(matrix.tasks.map((task) => task.taskId)).toEqual([
      "task-01-object-removal",
      "task-02-localized-add-replace",
      "task-03-color-material-change",
      "task-04-background-environment",
      "task-05-identity-preserving-edit",
      "task-06-sequential-stability",
    ]);
    expect(matrix.tasks).toHaveLength(6);
    expect(matrix.tasks.slice(0, 5).map((task) => task.invocationCount)).toEqual([1, 1, 1, 1, 1]);
    expect(matrix.tasks[5]).toMatchObject({ invocationCount: 3 });
    expect(matrix.tasks[5].steps).toHaveLength(3);
    expect(matrix.tasks[5].steps?.map((step) => step.sequenceStep)).toEqual([1, 2, 3]);
    expect(matrix.tasks[5].steps?.map((step) => step.source)).toEqual([
      "original",
      "prior_step_output",
      "prior_step_output",
    ]);
  });

  it("rejects mutations of the exact frozen task contract", () => {
    const mutations: Array<(value: Matrix) => void> = [
      (value) => { value.tasks[0].taskId = "changed-task"; },
      (value) => { value.tasks.reverse(); },
      (value) => { value.tasks[0].category = "changed_category"; },
      (value) => { value.tasks[0].instruction = "changed instruction"; },
      (value) => { value.tasks[0].invocationCount = 2; },
      (value) => { value.tasks[5].steps = value.tasks[5].steps?.slice(0, 2); },
      (value) => { value.tasks[5].steps![1].instruction = "changed sequential instruction"; },
      (value) => { value.tasks[5].steps![1].source = "original"; },
    ];

    for (const mutate of mutations) {
      const mutated = JSON.parse(JSON.stringify(matrix)) as Matrix;
      mutate(mutated);
      expect(() => validateMatrix(mutated)).toThrow();
    }
  });

  it("expands 120 logical scenarios and 160 ordered invocations deterministically", () => {
    const first = runDryRun("cs4a-unit-fixed");
    const second = runDryRun("cs4a-unit-fixed");

    expect(first.expectedScenarioCount).toBe(120);
    expect(first.expectedInvocationCount).toBe(160);
    expect(first.scenarios).toHaveLength(120);
    expect(first.invocations).toHaveLength(160);
    expect(new Set(first.scenarios.map((scenario) => scenario.scenarioId)).size).toBe(120);
    expect(new Set(first.invocations.map((invocation) => invocation.invocationId)).size).toBe(160);
    for (const candidate of candidates) {
      const candidateScenarios = first.scenarios.filter((scenario) => scenario.candidateId === candidate.candidateId);
      const candidateScenarioIds = new Set(candidateScenarios.map((scenario) => scenario.scenarioId));
      expect(candidateScenarios).toHaveLength(30);
      expect(first.invocations.filter((invocation) => candidateScenarioIds.has(invocation.scenarioId))).toHaveLength(40);
    }
    expect(second.scenarios).toEqual(first.scenarios);
    expect(second.invocations).toEqual(first.invocations);
  });

  it("keeps task instruction semantics identical across candidates", () => {
    const result = runDryRun("cs4a-prompt-parity");
    const grouped = new Map<string, QualificationScenario[]>();

    for (const scenario of result.scenarios) {
      const key = `${scenario.sourceId}:${scenario.taskId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), scenario]);
    }

    for (const scenarios of grouped.values()) {
      expect(scenarios).toHaveLength(4);
      expect(scenarios.map((scenario) => scenario.instructionReference)).toEqual([
        scenarios[0].instructionReference,
        scenarios[0].instructionReference,
        scenarios[0].instructionReference,
        scenarios[0].instructionReference,
      ]);
      expect(scenarios.map((scenario) => scenario.sequenceSteps)).toEqual([
        scenarios[0].sequenceSteps,
        scenarios[0].sequenceSteps,
        scenarios[0].sequenceSteps,
        scenarios[0].sequenceSteps,
      ]);
    }
  });

  it("models sequential steps as original then immediately preceding output", () => {
    const result = runDryRun("cs4a-sequence");
    const sequenceInvocations = result.invocations.filter((invocation) => invocation.sequenceId);

    expect(sequenceInvocations).toHaveLength(60);
    for (let index = 0; index < sequenceInvocations.length; index += 3) {
      const [stepOne, stepTwo, stepThree] = sequenceInvocations.slice(index, index + 3);
      expect(stepOne.sequenceStep).toBe(1);
      expect(stepOne.sourceArtifactReference).toBe(`matrix://${stepOne.scenarioId.split("__")[1]}`);
      expect(stepTwo.sequenceStep).toBe(2);
      expect(stepTwo.sourceArtifactReference).toBe(`invocation://${stepOne.invocationId}/output`);
      expect(stepThree.sequenceStep).toBe(3);
      expect(stepThree.sourceArtifactReference).toBe(`invocation://${stepTwo.invocationId}/output`);
    }
  });

  it("fails closed for live execution, arbitrary endpoints, and arbitrary candidates", () => {
    expectRejected(["--live"]);
    expectRejected(["--endpoint", "https://example.test"]);
    expectRejected(["--candidate", "unapproved"]);
  });

  it("rejects unsafe run IDs through the CLI before writing output", () => {
    const unsafeRunIds = [
      "..",
      "../escape",
      "..\\escape",
      "/absolute",
      "\\absolute",
      "",
      "   ",
      "with/slash",
      "with\\backslash",
      "test;rm",
      "$(test)",
      "`test`",
    ];

    for (const runId of unsafeRunIds) {
      expectRejected(["--dry-run", "--run-id", runId]);
    }

    expect(() => ensureSafeRunId("cs4a-safe-01")).not.toThrow();
    expect(runDryRun("cs4a-safe-01").runId).toBe("cs4a-safe-01");
  });

  it("executes production namespace rejection through the runner validator", () => {
    expect(() => ensureSafeFixturePath("generated/original.png")).toThrow(
      "production generated-image namespace is not allowed",
    );
    expect(() => ensureSafeFixturePath("generated\\original.png")).toThrow(
      "production generated-image namespace is not allowed",
    );
  });

  it("is isolated from application, provider, network, and production storage execution", () => {
    expect(runnerSource).not.toMatch(/from\s+["'][^"']*(?:app\/|supabase|provider)/i);
    expect(runnerSource).not.toContain("fetch(");
    expect(runnerSource).not.toMatch(/\bhttps?:\/\//i);
    expect(runnerSource).not.toContain("child_process");
    expect(runnerSource).not.toContain("import(");
    expect(runnerSource).not.toContain("process.env");
    expect(runnerSource).toContain("production generated-image namespace is not allowed");
    expect(runnerSource).toContain('join(REPOSITORY_ROOT, ".local", "qualification", "image-editing")');
  });

  it("writes a not-run result with null execution evidence and separate raw-output location", () => {
    const result = runDryRun("cs4a-result-shape");

    expect(result.status).toBe("dry_run");
    expect(result.completedScenarioCount).toBe(0);
    expect(result.completedInvocationCount).toBe(0);
    expect(result.resultFile).toBe("result.json");
    expect(result.rawOutputDirectory).toBe("raw");
    expect(result.invocations.every((invocation) => invocation.status === "not_run")).toBe(true);
    expect(result.invocations.every((invocation) =>
      invocation.startedAt === null &&
      invocation.endedAt === null &&
      invocation.latencyMs === null &&
      invocation.providerRequestId === null &&
      invocation.providerCost === null &&
      invocation.providerCostCurrency === null &&
      invocation.providerCostSource === null &&
      invocation.outputArtifactReference === null &&
      invocation.rawOutputArtifactReference === null &&
      invocation.outputSha256 === null &&
      invocation.failureCode === null &&
      invocation.failureNotes === null,
    )).toBe(true);
    expect(JSON.stringify(result)).not.toContain("data:image");
  });
});
