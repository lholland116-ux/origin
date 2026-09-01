import {
  createHash,
} from "node:crypto";

import type {
  CapaControlledPromptPackage,
  ControlledVersion,
  CapaAiRunId,
  CapaPromptPackageId,
} from "./capa-prompt-contract";

import type {
  CorrelationId,
  IsoDateTime,
  RequestId,
} from "../domain/capa-types";

import type {
  CapaIntakeAdvisoryResponse,
} from "./capa-intake-advisory-contract";

/**
 * Durable-generation-trace schema identity.
 *
 * The schema version describes the application-level immutable trace record,
 * not the database migration version.
 */
export const CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION =
  "capa-ai-generation-trace-1.0.0" as const;

/**
 * Canonical fingerprint algorithm.
 *
 * JSON objects are recursively key-sorted before UTF-8 SHA-256 hashing.
 * Array order is preserved because prompt-layer and evidence ordering are
 * semantically significant.
 */
export const CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM =
  "sha256-canonical-json-v1" as const;

export class CapaAiGenerationFingerprintError
  extends Error {
  constructor() {
    super(
      "The governed CAPA AI generation artifact cannot be canonically fingerprinted.",
    );

    this.name =
      "CapaAiGenerationFingerprintError";
  }
}

/**
 * Exact server-side generation artifact available immediately before the
 * structured model invocation.
 *
 * This value never crosses the browser authority boundary.
 */
export interface CapaIntakeAdvisoryGenerationTraceCapture {
  readonly prompt_package:
    CapaControlledPromptPackage;

  readonly rendered_prompt:
    string;

  readonly model_profile_version:
    ControlledVersion;
}

/**
 * Generator result consumed by the advisory service.
 *
 * The response remains the validated advisory result. The trace capture
 * preserves the exact governed generation artifact for atomic persistence.
 */
export interface CapaIntakeAdvisoryGenerationResult {
  readonly response:
    CapaIntakeAdvisoryResponse;

  readonly trace:
    CapaIntakeAdvisoryGenerationTraceCapture;
}

export interface CapaAiGenerationArtifactFingerprints {
  readonly algorithm:
    typeof CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM;

  readonly prompt_package_sha256:
    string;

  readonly rendered_prompt_sha256:
    string;
}

function canonicalValue(
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CapaAiGenerationFingerprintError();
    }

    return Object.is(value, -0)
      ? 0
      : value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        canonicalValue(item),
    );
  }

  if (
    typeof value === "object"
  ) {
    const prototype =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new CapaAiGenerationFingerprintError();
    }

    const source =
      value as Readonly<
        Record<string, unknown>
      >;

    const canonical:
      Record<string, unknown> = {};

    for (
      const key of Object.keys(source)
        .sort()
    ) {
      const item =
        source[key];

      if (item === undefined) {
        throw new CapaAiGenerationFingerprintError();
      }

      canonical[key] =
        canonicalValue(item);
    }

    return canonical;
  }

  throw new CapaAiGenerationFingerprintError();
}

export function canonicalJson(
  value: unknown,
): string {
  const serialized =
    JSON.stringify(
      canonicalValue(value),
    );

  if (
    typeof serialized !== "string"
  ) {
    throw new CapaAiGenerationFingerprintError();
  }

  return serialized;
}

export function sha256Utf8(
  value: string,
): string {
  return createHash("sha256")
    .update(
      value,
      "utf8",
    )
    .digest("hex");
}

export function fingerprintCanonicalJson(
  value: unknown,
): string {
  return sha256Utf8(
    canonicalJson(value),
  );
}

export const CAPA_CONTAINMENT_RISK_PROMPT_PACKAGE_SCHEMA_VERSION = "capa-containment-risk-prompt-package-1.0.0" as const;
export const CAPA_CONTAINMENT_RISK_EVIDENCE_MANIFEST_SCHEMA_VERSION = "capa-containment-risk-evidence-manifest-1.0.0" as const;
export const CAPA_CONTAINMENT_RISK_POLICY_MANIFEST_SCHEMA_VERSION = "capa-containment-risk-policy-manifest-1.0.0" as const;
export interface CapaContainmentRiskAdvisoryGenerationContract { readonly operation: "analyze_containment_impact_risk"; readonly requested_output: "containment_risk_analysis"; readonly output_schema_version: "capa-containment-risk-advisory-1.0.0"; readonly model_profile_version: string; readonly output_schema_name: string; readonly output_schema_sha256: string; readonly store: false; readonly maximum_output_characters: number; }
export interface CapaContainmentRiskAdvisoryContextProvenance { readonly authoritative_server_context: unknown; readonly untrusted_human_draft: unknown; readonly focus: string | null; }
export interface CapaContainmentRiskAdvisoryGovernance { readonly advisory_only: true; readonly workflow_mutated: false; readonly human_acceptance_required: true; }
export interface CapaContainmentRiskAdvisoryEvidenceManifest { readonly evidence_manifest_schema_version: typeof CAPA_CONTAINMENT_RISK_EVIDENCE_MANIFEST_SCHEMA_VERSION; readonly retrieval_performed: false; readonly item_count: 0; readonly items: readonly []; }
export interface CapaContainmentRiskAdvisoryPolicyManifest { readonly policy_manifest_schema_version: typeof CAPA_CONTAINMENT_RISK_POLICY_MANIFEST_SCHEMA_VERSION; readonly agent: Readonly<{ agent_id: "AG-INTAKE"; agent_version: "ag-intake-1.0.0" }>; readonly workflow_state: "S20"; readonly operation: "analyze_containment_impact_risk"; readonly requested_output: "containment_risk_analysis"; readonly output_schema_version: "capa-containment-risk-advisory-1.0.0"; readonly generation: Readonly<{ model_profile_version: string; output_schema_name: string; output_schema_sha256: string }>; readonly authority: CapaContainmentRiskAdvisoryGovernance; readonly prohibitions: readonly string[]; }
export interface CapaContainmentRiskAdvisoryGenerationFingerprints { readonly algorithm: typeof CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM; readonly prompt_package_sha256: string; readonly rendered_prompt_sha256: string; readonly evidence_manifest_sha256: string; readonly policy_manifest_sha256: string; readonly output_schema_sha256: string; }
export interface CapaContainmentRiskAdvisoryPromptPackage { readonly package_schema_version: typeof CAPA_CONTAINMENT_RISK_PROMPT_PACKAGE_SCHEMA_VERSION; readonly scope: Readonly<{ organization_id: string; capa_case_id: string; case_version_id: string; record_version: number; workflow_state: "S20" }>; readonly agent: Readonly<{ agent_id: "AG-INTAKE"; agent_version: string }>; readonly trace: Readonly<{ readonly run_id: CapaAiRunId; readonly prompt_package_id: CapaPromptPackageId; readonly request_id: RequestId; readonly correlation_id: CorrelationId; readonly assembled_at: IsoDateTime; }>; readonly generation_contract: CapaContainmentRiskAdvisoryGenerationContract; readonly context_provenance: CapaContainmentRiskAdvisoryContextProvenance; readonly governance: CapaContainmentRiskAdvisoryGovernance; }
export type CapaContainmentRiskAdvisoryPromptPackageInput = Omit<CapaContainmentRiskAdvisoryPromptPackage, "package_schema_version" | "generation_contract">;
export type CapaContainmentRiskAdvisoryPolicyManifestInput = { readonly agent: Readonly<{ agent_id: "AG-INTAKE" | string; agent_version: "ag-intake-1.0.0" | string }>; readonly workflow_state: "S20"; readonly operation: "analyze_containment_impact_risk" | string; readonly requested_output: "containment_risk_analysis" | string; readonly output_schema_version: "capa-containment-risk-advisory-1.0.0" | string; readonly generation: Readonly<{ model_profile_version: string; output_schema_name: string }> ; readonly authority: CapaContainmentRiskAdvisoryGovernance; readonly prohibitions: readonly string[] };
export interface CapaContainmentRiskAdvisoryGenerationTraceCapture {
  readonly trace_schema_version: typeof CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION;
  readonly package: CapaContainmentRiskAdvisoryPromptPackage;
  readonly rendered_prompt: string;
  readonly model_profile_version: string;
  readonly output_schema_name: string;
  readonly output_schema: unknown;
  readonly store: false;
  readonly maximum_output_characters: number;
  readonly evidence_manifest: CapaContainmentRiskAdvisoryEvidenceManifest;
  readonly policy_manifest: CapaContainmentRiskAdvisoryPolicyManifest;
  readonly fingerprints: CapaContainmentRiskAdvisoryGenerationFingerprints;
}

export function createCapaContainmentRiskAdvisoryGenerationTrace(input: {
  readonly rendered_prompt: string; readonly model_profile_version: string; readonly output_schema_name: string; readonly output_schema: unknown; readonly maximum_output_characters: number; readonly package: CapaContainmentRiskAdvisoryPromptPackageInput; readonly policy_manifest: CapaContainmentRiskAdvisoryPolicyManifestInput;
}): CapaContainmentRiskAdvisoryGenerationTraceCapture {
  const snapshot = <T>(value: T): T => JSON.parse(canonicalJson(value)) as T;
  const freeze = <T>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; };
  const evidence_manifest: CapaContainmentRiskAdvisoryEvidenceManifest = freeze(snapshot({ evidence_manifest_schema_version: CAPA_CONTAINMENT_RISK_EVIDENCE_MANIFEST_SCHEMA_VERSION, retrieval_performed: false as const, item_count: 0 as const, items: [] as const }));
  const output_schema_snapshot = freeze(snapshot(input.output_schema));
  const output_schema_sha256 = fingerprintCanonicalJson(output_schema_snapshot);
  const pkg: CapaContainmentRiskAdvisoryPromptPackage = freeze(snapshot({ ...input.package, package_schema_version: CAPA_CONTAINMENT_RISK_PROMPT_PACKAGE_SCHEMA_VERSION, generation_contract: { operation: "analyze_containment_impact_risk", requested_output: "containment_risk_analysis", output_schema_version: "capa-containment-risk-advisory-1.0.0", model_profile_version: input.model_profile_version, output_schema_name: input.output_schema_name, output_schema_sha256, store: false as const, maximum_output_characters: input.maximum_output_characters } }));
  const policy_manifest: CapaContainmentRiskAdvisoryPolicyManifest = freeze(snapshot({ ...input.policy_manifest, policy_manifest_schema_version: CAPA_CONTAINMENT_RISK_POLICY_MANIFEST_SCHEMA_VERSION, agent: { agent_id: "AG-INTAKE" as const, agent_version: "ag-intake-1.0.0" as const }, workflow_state: "S20" as const, operation: "analyze_containment_impact_risk" as const, requested_output: "containment_risk_analysis" as const, output_schema_version: "capa-containment-risk-advisory-1.0.0" as const, generation: { ...input.policy_manifest.generation, output_schema_sha256 } }));
  const fingerprints: CapaContainmentRiskAdvisoryGenerationFingerprints = Object.freeze({ algorithm: CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM, prompt_package_sha256: fingerprintCanonicalJson(pkg), rendered_prompt_sha256: sha256Utf8(input.rendered_prompt), evidence_manifest_sha256: fingerprintCanonicalJson(evidence_manifest), policy_manifest_sha256: fingerprintCanonicalJson(policy_manifest), output_schema_sha256 });
  const result: CapaContainmentRiskAdvisoryGenerationTraceCapture = { trace_schema_version: CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION, package: pkg, rendered_prompt: input.rendered_prompt, model_profile_version: input.model_profile_version, output_schema_name: input.output_schema_name, output_schema: output_schema_snapshot, store: false, maximum_output_characters: input.maximum_output_characters, evidence_manifest, policy_manifest, fingerprints };
  return Object.freeze(result);
}

export function createCapaAiGenerationArtifactFingerprints(
  trace:
    CapaIntakeAdvisoryGenerationTraceCapture,
): CapaAiGenerationArtifactFingerprints {
  return Object.freeze({
    algorithm:
      CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,

    prompt_package_sha256:
      fingerprintCanonicalJson(
        trace.prompt_package,
      ),

    /*
     * This hash intentionally covers the exact UTF-8 rendered string sent to
     * the model. It is not canonicalized because whitespace and serialization
     * are part of the exact model input.
     */
    rendered_prompt_sha256:
      sha256Utf8(
        trace.rendered_prompt,
      ),
  });
}

export interface CapaAiGenerationEvidenceManifestItem {
  readonly organization_id: string;
  readonly collection_id: string;
  readonly source_id: string;
  readonly source_version: string;
  readonly passage_id: string;
  readonly source_status: string;
  readonly source_type: string;
  readonly title: string;
  readonly precise_locator: string;
  readonly retrieved_at: string;
  readonly issuer: string | null;
  readonly jurisdiction: string | null;

  /**
   * Fingerprint of the exact retrieved-source object admitted to prompt
   * layer seven.
   */
  readonly item_sha256: string;

  /**
   * Fingerprint of the exact UTF-8 evidence text admitted to the model.
   */
  readonly text_sha256: string;
}

export interface CapaAiGenerationEvidenceManifest {
  readonly layer_position: 7;
  readonly layer_name: "retrieved_sources";
  readonly layer_trust: "untrusted_data";
  readonly layer_content_version:
    string | null;
  readonly item_count: number;
  readonly layer_content_sha256: string;
  readonly items:
    readonly CapaAiGenerationEvidenceManifestItem[];
}

export interface CapaAiGenerationPolicyLayerManifest {
  readonly position: number;
  readonly name: string;
  readonly trust: string;
  readonly content_version:
    string | null;
  readonly content_sha256: string;
}

export interface CapaAiGenerationPolicyManifest {
  readonly agent:
    CapaControlledPromptPackage["agent"];

  readonly component_versions:
    CapaControlledPromptPackage["component_versions"];

  readonly governance_layers:
    readonly CapaAiGenerationPolicyLayerManifest[];

  readonly reduction_applied: boolean;

  readonly reduction_record_sha256:
    string | null;
}

export interface CapaAiGenerationTraceArtifacts
  extends CapaAiGenerationArtifactFingerprints {
  readonly evidence_manifest:
    CapaAiGenerationEvidenceManifest;

  readonly evidence_manifest_sha256:
    string;

  readonly policy_manifest:
    CapaAiGenerationPolicyManifest;

  readonly policy_manifest_sha256:
    string;
}

function isPlainRecord(
  value: unknown,
): value is Readonly<
  Record<string, unknown>
> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function manifestString(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new CapaAiGenerationFingerprintError();
  }

  return value;
}

function manifestOptionalString(
  value: unknown,
): string | null {
  if (value === undefined) {
    return null;
  }

  return manifestString(value);
}

function promptLayer(
  promptPackage:
    CapaControlledPromptPackage,
  name: string,
) {
  const layer =
    promptPackage.layers.find(
      (candidate) =>
        candidate.name === name,
    );

  if (layer === undefined) {
    throw new CapaAiGenerationFingerprintError();
  }

  return layer;
}

function createEvidenceManifestItem(
  value: unknown,
): CapaAiGenerationEvidenceManifestItem {
  if (!isPlainRecord(value)) {
    throw new CapaAiGenerationFingerprintError();
  }

  const text =
    value.text;

  if (
    !isPlainRecord(text) ||
    text.trust !== "untrusted_data" ||
    text.provenance_type !==
      "retrieved_passage"
  ) {
    throw new CapaAiGenerationFingerprintError();
  }

  const content =
    manifestString(
      text.content,
    );

  return Object.freeze({
    organization_id:
      manifestString(
        value.organization_id,
      ),

    collection_id:
      manifestString(
        value.collection_id,
      ),

    source_id:
      manifestString(
        value.source_id,
      ),

    source_version:
      manifestString(
        value.source_version,
      ),

    passage_id:
      manifestString(
        value.passage_id,
      ),

    source_status:
      manifestString(
        value.source_status,
      ),

    source_type:
      manifestString(
        value.source_type,
      ),

    title:
      manifestString(
        value.title,
      ),

    precise_locator:
      manifestString(
        value.precise_locator,
      ),

    retrieved_at:
      manifestString(
        value.retrieved_at,
      ),

    issuer:
      manifestOptionalString(
        value.issuer,
      ),

    jurisdiction:
      manifestOptionalString(
        value.jurisdiction,
      ),

    item_sha256:
      fingerprintCanonicalJson(
        value,
      ),

    text_sha256:
      sha256Utf8(
        content,
      ),
  });
}

export function createCapaAiGenerationEvidenceManifest(
  promptPackage:
    CapaControlledPromptPackage,
): CapaAiGenerationEvidenceManifest {
  const layer =
    promptLayer(
      promptPackage,
      "retrieved_sources",
    );

  if (
    layer.position !== 7 ||
    layer.name !==
      "retrieved_sources" ||
    layer.trust !==
      "untrusted_data" ||
    !Array.isArray(layer.content)
  ) {
    throw new CapaAiGenerationFingerprintError();
  }

  const items =
    Object.freeze(
      layer.content.map(
        (value) =>
          createEvidenceManifestItem(
            value,
          ),
      ),
    );

  return Object.freeze({
    layer_position: 7,
    layer_name:
      "retrieved_sources",
    layer_trust:
      "untrusted_data",

    layer_content_version:
      layer.content_version ??
      null,

    item_count:
      items.length,

    layer_content_sha256:
      fingerprintCanonicalJson(
        layer.content,
      ),

    items,
  });
}

const GOVERNANCE_LAYER_NAMES =
  Object.freeze([
    "platform_system_policy",
    "product_policy",
    "agent_definition",
    "authorization_context",
    "output_contract",
  ] as const);

function createPolicyLayerManifest(
  promptPackage:
    CapaControlledPromptPackage,
  name:
    (typeof GOVERNANCE_LAYER_NAMES)[number],
): CapaAiGenerationPolicyLayerManifest {
  const layer =
    promptLayer(
      promptPackage,
      name,
    );

  return Object.freeze({
    position:
      layer.position,

    name:
      layer.name,

    trust:
      layer.trust,

    content_version:
      layer.content_version ??
      null,

    content_sha256:
      fingerprintCanonicalJson(
        layer.content,
      ),
  });
}

export function createCapaAiGenerationPolicyManifest(
  promptPackage:
    CapaControlledPromptPackage,
): CapaAiGenerationPolicyManifest {
  const governanceLayers =
    Object.freeze(
      GOVERNANCE_LAYER_NAMES.map(
        (name) =>
          createPolicyLayerManifest(
            promptPackage,
            name,
          ),
      ),
    );

  return Object.freeze({
    agent:
      promptPackage.agent,

    component_versions:
      promptPackage
        .component_versions,

    governance_layers:
      governanceLayers,

    reduction_applied:
      promptPackage
        .reduction_applied,

    reduction_record_sha256:
      promptPackage
        .reduction_record ===
      undefined
        ? null
        : fingerprintCanonicalJson(
            promptPackage
              .reduction_record,
          ),
  });
}

export function createCapaAiGenerationTraceArtifacts(
  trace:
    CapaIntakeAdvisoryGenerationTraceCapture,
): CapaAiGenerationTraceArtifacts {
  const fingerprints =
    createCapaAiGenerationArtifactFingerprints(
      trace,
    );

  const evidenceManifest =
    createCapaAiGenerationEvidenceManifest(
      trace.prompt_package,
    );

  const policyManifest =
    createCapaAiGenerationPolicyManifest(
      trace.prompt_package,
    );

  return Object.freeze({
    ...fingerprints,

    evidence_manifest:
      evidenceManifest,

    evidence_manifest_sha256:
      fingerprintCanonicalJson(
        evidenceManifest,
      ),

    policy_manifest:
      policyManifest,

    policy_manifest_sha256:
      fingerprintCanonicalJson(
        policyManifest,
      ),
  });
}
