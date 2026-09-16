import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validatePositiveBudgetUsd } from "./live/contracts.mjs";

const RUNNER_VERSION = "lvtchat-image-edit-qualification-runner-1.0.0";
const RESULT_SCHEMA_VERSION = "lvtchat-image-edit-qualification-result-1.0.0";
const EXPECTED_SCENARIO_COUNT = 90;
const EXPECTED_INVOCATION_COUNT = 120;
const CANDIDATE_KEYS = ["candidateId", "provider", "displayName", "declaredModelRef"];
const EXPECTED_CANDIDATES = [
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
    candidateId: "replicate-flux1-kontext-dev",
    provider: "replicate",
    displayName: "FLUX.1 Kontext Dev",
    declaredModelRef: "black-forest-labs/flux-kontext-dev",
  },
];
const EXPECTED_SOURCE_IDS = [
  "source-01",
  "source-02",
  "source-03",
  "source-04",
  "source-05",
];
const EXPECTED_TASK_IDS = [
  "task-01-object-removal",
  "task-02-localized-add-replace",
  "task-03-color-material-change",
  "task-04-background-environment",
  "task-05-identity-preserving-edit",
  "task-06-sequential-stability",
];
const EXPECTED_TASKS = [
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

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../../..");
const QUALIFICATION_ROOT = join(REPOSITORY_ROOT, ".local", "qualification", "image-editing");

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(fileName) {
  return JSON.parse(await readFile(join(SCRIPT_DIRECTORY, fileName), "utf8"));
}

function sameKeys(value, expectedKeys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
  );
}

function ensureSafeRunId(runId) {
  ensure(
    typeof runId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId),
    "run ID must be a simple local identifier without path separators",
  );
}

function ensureSafeFixturePath(fixtureRelativePath) {
  if (fixtureRelativePath === null) return;

  ensure(typeof fixtureRelativePath === "string" && fixtureRelativePath.length > 0, "fixture path must be null or a non-empty relative path");
  const normalized = fixtureRelativePath.replaceAll("\\", "/");
  ensure(!isAbsolute(fixtureRelativePath), "absolute fixture paths are not allowed");
  ensure(!normalized.split("/").includes(".."), "fixture paths cannot escape the qualification directory");
  ensure(!normalized.startsWith("generated/"), "production generated-image namespace is not allowed");
  ensure(!normalized.startsWith(".local/"), "qualification output paths cannot be used as source fixtures");
}

function ensureSafeArtifactReference(reference) {
  ensure(
    reference.startsWith("matrix://") || reference.startsWith("invocation://"),
    "only logical qualification artifact references are allowed",
  );
  ensure(!reference.includes("generated/"), "production generated-image namespace is not allowed");
}

function validateCandidates(manifest) {
  ensure(manifest && manifest.schemaVersion === "lvtchat-image-edit-qualification-candidates-1.0.0", "unsupported candidate manifest");
  ensure(Array.isArray(manifest.candidates) && manifest.candidates.length === EXPECTED_CANDIDATES.length, "candidate manifest must contain exactly three candidates");

  manifest.candidates.forEach((candidate, index) => {
    ensure(sameKeys(candidate, CANDIDATE_KEYS), `candidate ${index + 1} contains unsupported fields`);
    ensure(JSON.stringify(candidate) === JSON.stringify(EXPECTED_CANDIDATES[index]), `candidate ${index + 1} does not match the controlled allowlist`);
  });
}

function validateMatrix(matrix) {
  ensure(matrix && matrix.schemaVersion === "lvtchat-image-edit-qualification-matrix-1.0.0", "unsupported qualification matrix");
  ensure(Array.isArray(matrix.sources) && matrix.sources.length === EXPECTED_SOURCE_IDS.length, "matrix must contain exactly five sources");
  ensure(Array.isArray(matrix.tasks) && matrix.tasks.length === EXPECTED_TASK_IDS.length, "matrix must contain exactly six tasks");

  matrix.sources.forEach((source, index) => {
    ensure(source.sourceId === EXPECTED_SOURCE_IDS[index], `source ${index + 1} is out of deterministic order`);
    ensure(sameKeys(source, ["sourceId", "fixtureRelativePath", "sha256", "mimeType", "label", "fixtureVersion"]), `source ${source.sourceId} contains unsupported fields`);
    ensure(typeof source.label === "string" && source.label.length > 0, `source ${source.sourceId} needs a descriptive label`);
    ensure(source.sha256 === null || typeof source.sha256 === "string", `source ${source.sourceId} hash must be null or a string`);
    ensure(source.mimeType === null || typeof source.mimeType === "string", `source ${source.sourceId} MIME type must be null or a string`);
    ensure(source.fixtureVersion === null || typeof source.fixtureVersion === "string", `source ${source.sourceId} fixture version must be null or a string`);
    ensureSafeFixturePath(source.fixtureRelativePath);
  });

  matrix.tasks.forEach((task, index) => {
    ensure(
      JSON.stringify(task) === JSON.stringify(EXPECTED_TASKS[index]),
      `task ${index + 1} does not match the controlled task contract`,
    );
  });
}

function instructionReference(taskIndex, stepIndex = null) {
  if (stepIndex === null) return `matrix.json#/tasks/${taskIndex}/instruction`;
  return `matrix.json#/tasks/${taskIndex}/steps/${stepIndex}/instruction`;
}

function expandQualificationMatrix(manifest, matrix) {
  const scenarios = [];
  const invocations = [];

  manifest.candidates.forEach((candidate) => {
    matrix.sources.forEach((source) => {
      matrix.tasks.forEach((task, taskIndex) => {
        const scenarioId = `${candidate.candidateId}__${source.sourceId}__${task.taskId}`;
        const steps = task.steps ?? [{ sequenceStep: 1, source: "original", instruction: task.instruction }];
        const sequenceId = task.steps ? `${scenarioId}__sequence` : null;
        const sequenceSteps = task.steps
          ? task.steps.map((step, stepIndex) => ({
              sequenceStep: step.sequenceStep,
              source: step.source,
              instructionReference: instructionReference(taskIndex, stepIndex),
            }))
          : [];

        scenarios.push({
          scenarioId,
          candidateId: candidate.candidateId,
          sourceId: source.sourceId,
          taskId: task.taskId,
          instruction: task.instruction ?? null,
          instructionReference: task.steps
            ? `matrix.json#/tasks/${taskIndex}/steps`
            : instructionReference(taskIndex),
          invocationCount: task.invocationCount,
          status: "not_run",
          sequenceSteps,
          evaluation: null,
        });

        steps.forEach((step, stepIndex) => {
          const invocationId = `${scenarioId}__invocation-${step.sequenceStep}`;
          const previousInvocation = stepIndex > 0 ? invocations[invocations.length - 1] : null;
          const sourceArtifactReference = previousInvocation
            ? `invocation://${previousInvocation.invocationId}/output`
            : `matrix://${source.sourceId}`;
          ensureSafeArtifactReference(sourceArtifactReference);

          invocations.push({
            invocationId,
            scenarioId,
            sequenceId,
            sequenceStep: step.sequenceStep,
            sourceArtifactReference,
            sourceSha256: stepIndex === 0 ? source.sha256 : null,
            startedAt: null,
            endedAt: null,
            latencyMs: null,
            status: "not_run",
            providerRequestId: null,
            providerCost: null,
            providerCostCurrency: null,
            providerCostSource: null,
            outputArtifactReference: null,
            rawOutputArtifactReference: null,
            outputSha256: null,
            failureCode: null,
            failureNotes: null,
          });
        });
      });
    });
  });

  ensure(scenarios.length === EXPECTED_SCENARIO_COUNT, `expected ${EXPECTED_SCENARIO_COUNT} logical scenarios, got ${scenarios.length}`);
  ensure(invocations.length === EXPECTED_INVOCATION_COUNT, `expected ${EXPECTED_INVOCATION_COUNT} invocations, got ${invocations.length}`);
  ensure(new Set(scenarios.map((scenario) => scenario.scenarioId)).size === scenarios.length, "scenario IDs must be unique");
  ensure(new Set(invocations.map((invocation) => invocation.invocationId)).size === invocations.length, "invocation IDs must be unique");

  return { scenarios, invocations };
}

function defaultRunId() {
  return new Date().toISOString().replace(/[^0-9A-Za-z-]/g, "").slice(0, 24);
}

function argumentValue(argumentsList, index, option) {
  const value = argumentsList[index + 1];
  ensure(typeof value === "string" && value.length > 0 && !value.startsWith("--"), `${option} requires a value`);
  return value;
}

function parseArguments(argumentsList) {
  let runId = defaultRunId();
  let dryRun = false;
  let live = false;
  let candidateId = null;
  let sourceId = null;
  let taskId = null;
  let confirmPaidQualification = false;
  let maxSpendUsd = null;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--dry-run") {
      ensure(!live, "--dry-run and --live cannot be combined");
      dryRun = true;
      continue;
    }
    if (argument === "--live") {
      ensure(!dryRun, "--dry-run and --live cannot be combined");
      live = true;
      continue;
    }
    if (argument === "--candidate") {
      ensure(candidateId === null, "--candidate may be specified only once");
      candidateId = argumentValue(argumentsList, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--source") {
      ensure(sourceId === null, "--source may be specified only once");
      sourceId = argumentValue(argumentsList, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--task") {
      ensure(taskId === null, "--task may be specified only once");
      taskId = argumentValue(argumentsList, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--confirm-paid-qualification") {
      ensure(!confirmPaidQualification, "--confirm-paid-qualification may be specified only once");
      confirmPaidQualification = true;
      continue;
    }
    if (argument === "--max-spend-usd") {
      ensure(maxSpendUsd === null, "--max-spend-usd may be specified only once");
      maxSpendUsd = argumentValue(argumentsList, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--run-id") {
      runId = argumentValue(argumentsList, index, argument);
      index += 1;
      ensureSafeRunId(runId);
      continue;
    }

    throw new Error(`unsupported option ${argument}; this harness supports dry-run only`);
  }

  return { runId, dryRun, live, candidateId, sourceId, taskId, confirmPaidQualification, maxSpendUsd };
}

function validateLiveSmokeArguments(options) {
  if (!options.live) {
    ensure(!options.candidateId && !options.sourceId && !options.taskId && !options.confirmPaidQualification && options.maxSpendUsd === null, "live qualification options require --live");
    return;
  }

  ensure(EXPECTED_CANDIDATES.some((candidate) => candidate.candidateId === options.candidateId), "live smoke requires one approved candidate");
  ensure(EXPECTED_SOURCE_IDS.includes(options.sourceId), "live smoke requires one approved source");
  ensure(EXPECTED_TASK_IDS.includes(options.taskId), "live smoke requires one approved task");
  ensure(options.confirmPaidQualification, "live smoke requires --confirm-paid-qualification");
  validatePositiveBudgetUsd(options.maxSpendUsd);
  throw new Error("LIVE_QUALIFICATION_NOT_IMPLEMENTED");
}

async function run(argumentsList = []) {
  const options = parseArguments(argumentsList);
  validateLiveSmokeArguments(options);
  const { runId, dryRun } = options;
  ensure(dryRun || argumentsList.length === 0, "only dry-run execution is available in CS4A");

  const [manifest, matrix] = await Promise.all([
    readJson("candidates.json"),
    readJson("matrix.json"),
  ]);
  validateCandidates(manifest);
  validateMatrix(matrix);

  const { scenarios, invocations } = expandQualificationMatrix(manifest, matrix);
  const startedAt = new Date().toISOString();
  const endedAt = new Date().toISOString();
  const result = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId,
    runnerVersion: RUNNER_VERSION,
    matrixVersion: matrix.schemaVersion,
    candidateManifestVersion: manifest.schemaVersion,
    gitCommit: null,
    startedAt,
    endedAt,
    status: "dry_run",
    expectedScenarioCount: EXPECTED_SCENARIO_COUNT,
    expectedInvocationCount: EXPECTED_INVOCATION_COUNT,
    completedScenarioCount: 0,
    completedInvocationCount: 0,
    candidates: manifest.candidates,
    scenarios,
    invocations,
    resultFile: "result.json",
    rawOutputDirectory: "raw",
  };

  const runDirectory = join(QUALIFICATION_ROOT, runId);
  const rawDirectory = join(runDirectory, "raw");
  const resultFile = join(runDirectory, result.resultFile);
  const outputRelativeToRoot = relative(QUALIFICATION_ROOT, runDirectory);
  ensure(outputRelativeToRoot && !outputRelativeToRoot.startsWith("..") && !isAbsolute(outputRelativeToRoot), "result path must remain under the qualification root");

  await mkdir(rawDirectory, { recursive: true });
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return resultFile;
}

export { ensureSafeFixturePath, ensureSafeRunId, parseArguments, validateLiveSmokeArguments, validateMatrix };

const invokedScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedScript) {
  run(process.argv.slice(2))
    .then((resultFile) => {
      console.log(`dry-run result: ${resultFile}`);
    })
    .catch((error) => {
      console.error(`qualification harness rejected execution: ${error.message}`);
      process.exitCode = 1;
    });
}
