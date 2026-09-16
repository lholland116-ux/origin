const QUALIFICATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const REQUEST_KEYS = [
  "candidateId",
  "provider",
  "modelRef",
  "sourceId",
  "invocationId",
  "taskId",
  "sequenceId",
  "sequenceStep",
  "sourceBytes",
  "sourceMimeType",
  "instruction",
  "runId",
  "authorizedBudgetUsd",
];
const OUTPUT_KEYS = [
  "provider",
  "candidateId",
  "modelRef",
  "providerRequestId",
  "outputBytes",
  "outputMimeType",
  "startedAt",
  "endedAt",
  "latencyMs",
  "providerCost",
  "providerCostCurrency",
  "providerCostSource",
  "estimatedCost",
  "estimatedCostSource",
  "sanitizedProviderMetadata",
  "failureCode",
  "failureMessage",
];
const FORBIDDEN_PRODUCTION_REFERENCES = [
  "generated/",
  "user/",
  "conversation/",
  "signed",
  "storage",
  "http://",
  "https://",
  "data:image/",
];
const SENSITIVE_METADATA_KEYS = /(?:authorization|api[_-]?key|secret|token|password|credential)/i;

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensureExactKeys(value, expectedKeys, label) {
  ensure(isPlainObject(value), `${label} must be an object`);
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  ensure(JSON.stringify(actualKeys) === JSON.stringify(sortedExpectedKeys), `${label} contains unsupported fields`);
}

function ensureQualificationId(value, label) {
  ensure(typeof value === "string" && QUALIFICATION_ID_PATTERN.test(value), `${label} must be a qualification identifier`);
}

function ensureNoProductionReference(value, label) {
  if (typeof value !== "string") return;
  const normalized = value.toLowerCase();
  ensure(
    !FORBIDDEN_PRODUCTION_REFERENCES.some((reference) => normalized.includes(reference)),
    `${label} contains a production reference`,
  );
}

function validateQualificationArtifactPath(pathValue, label = "artifact path") {
  ensure(typeof pathValue === "string" && pathValue.length > 0, `${label} must be a non-empty relative path`);
  const normalized = pathValue.replaceAll("\\", "/");
  ensure(!normalized.startsWith("/"), `${label} must be relative`);
  ensure(!/^[A-Za-z]:\//.test(normalized), `${label} must be relative`);
  ensure(!normalized.split("/").includes(".."), `${label} cannot escape the qualification root`);
  ensure(!normalized.startsWith("generated/"), "production generated-image namespace is not allowed");
  ensure(!normalized.startsWith(".local/"), `${label} cannot reference a qualification output root`);
  return pathValue;
}

function ensureSafeMetadata(value, path = "metadata") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => ensureSafeMetadata(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;

  Object.entries(value).forEach(([key, child]) => {
    ensure(!SENSITIVE_METADATA_KEYS.test(key), `${path}.${key} is not permitted in sanitized metadata`);
    ensureNoProductionReference(child, `${path}.${key}`);
    ensureSafeMetadata(child, `${path}.${key}`);
  });
}

function validatePositiveBudgetUsd(value) {
  const isString = typeof value === "string";
  const normalized = isString ? value.trim() : value;
  if (isString) {
    ensure(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(normalized), "max spend must be a finite positive decimal");
  }
  const numberValue = typeof normalized === "number" ? normalized : Number(normalized);
  ensure(Number.isFinite(numberValue) && numberValue > 0, "max spend must be a finite positive decimal");
  return numberValue;
}

function validateQualificationEditRequest(request) {
  ensureExactKeys(request, REQUEST_KEYS, "qualification edit request");
  ["candidateId", "provider", "sourceId", "invocationId", "taskId", "runId"].forEach((key) => {
    ensureQualificationId(request[key], key);
    ensureNoProductionReference(request[key], key);
  });
  ensure(request.sequenceId === null || (typeof request.sequenceId === "string" && QUALIFICATION_ID_PATTERN.test(request.sequenceId)), "sequenceId must be null or a qualification identifier");
  ensure(typeof request.sourceBytes === "object" && request.sourceBytes instanceof Uint8Array, "sourceBytes must be Uint8Array");
  ensure(request.sourceBytes.length > 0, "sourceBytes must not be empty");
  ensure(SUPPORTED_IMAGE_MIME_TYPES.has(request.sourceMimeType), "sourceMimeType must be a supported image MIME type");
  ensure(typeof request.instruction === "string" && request.instruction.trim().length > 0, "instruction must be non-empty");
  ensure(request.instruction.length <= 4000, "instruction exceeds the qualification prompt limit");
  ensure(typeof request.modelRef === "string" && request.modelRef.length > 0, "modelRef must be non-empty");
  ensure(Number.isSafeInteger(request.sequenceStep) && request.sequenceStep >= 1, "sequenceStep must be a positive safe integer");
  validatePositiveBudgetUsd(request.authorizedBudgetUsd);
  ensureNoProductionReference(request.modelRef, "modelRef");
  return request;
}

function buildQualificationEditRequest(request) {
  validateQualificationEditRequest(request);
  return Object.freeze({ ...request, sourceBytes: new Uint8Array(request.sourceBytes) });
}

function validateQualificationEditOutput(output) {
  ensureExactKeys(output, OUTPUT_KEYS, "qualification edit output");
  ["provider", "candidateId", "modelRef"].forEach((key) => {
    ensure(typeof output[key] === "string" && output[key].length > 0, `${key} must be non-empty`);
    ensureNoProductionReference(output[key], key);
  });
  ensure(output.providerRequestId === null || typeof output.providerRequestId === "string", "providerRequestId must be null or a string");
  ensure(output.outputBytes === null || output.outputBytes instanceof Uint8Array, "outputBytes must be null or Uint8Array");
  if (output.outputBytes !== null) ensure(output.outputBytes.length > 0, "outputBytes must not be empty");
  ensure(output.outputMimeType === null || SUPPORTED_IMAGE_MIME_TYPES.has(output.outputMimeType), "outputMimeType must be null or a supported image MIME type");
  ensure(typeof output.startedAt === "string" && typeof output.endedAt === "string", "output timestamps must be strings");
  ensure(Number.isFinite(output.latencyMs) && output.latencyMs >= 0, "latencyMs must be a non-negative finite number");
  ["providerCost", "estimatedCost"].forEach((key) => {
    ensure(output[key] === null || (Number.isFinite(output[key]) && output[key] >= 0), `${key} must be null or a non-negative finite number`);
  });
  ensure(output.providerCostCurrency === null || typeof output.providerCostCurrency === "string", "providerCostCurrency must be null or a string");
  ensure(output.providerCostSource === null || output.providerCostSource === "provider_reported" || output.providerCostSource === "not_reported", "providerCostSource is invalid");
  ensure(output.estimatedCostSource === null || output.estimatedCostSource === "local_estimate", "estimatedCostSource is invalid");
  if (output.providerCost !== null) {
    ensure(output.providerCostSource === "provider_reported", "providerCost must be provider-reported");
    ensure(typeof output.providerCostCurrency === "string" && output.providerCostCurrency.length > 0, "providerCost requires a currency");
  } else {
    ensure(output.providerCostSource === null || output.providerCostSource === "not_reported", "missing providerCost cannot be marked reported");
  }
  if (output.estimatedCost !== null) {
    ensure(output.estimatedCostSource === "local_estimate", "estimatedCost must be marked as a local estimate");
  } else {
    ensure(output.estimatedCostSource === null, "missing estimatedCost cannot have an estimate source");
  }
  ensure(isPlainObject(output.sanitizedProviderMetadata), "sanitizedProviderMetadata must be an object");
  ensureSafeMetadata(output.sanitizedProviderMetadata);
  ensure(output.failureCode === null || typeof output.failureCode === "string", "failureCode must be null or a string");
  ensure(output.failureMessage === null || typeof output.failureMessage === "string", "failureMessage must be null or a string");
  ensureNoProductionReference(output.failureMessage, "failureMessage");
  return output;
}

function buildQualificationEditOutput(output) {
  validateQualificationEditOutput(output);
  return Object.freeze({ ...output, outputBytes: output.outputBytes && new Uint8Array(output.outputBytes) });
}

export {
  buildQualificationEditOutput,
  buildQualificationEditRequest,
  validatePositiveBudgetUsd,
  validateQualificationArtifactPath,
  validateQualificationEditOutput,
  validateQualificationEditRequest,
};
