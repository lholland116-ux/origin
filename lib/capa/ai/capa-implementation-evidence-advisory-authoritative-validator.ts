import type { CapaImplementationEvidenceAdvisoryResponse } from "./capa-implementation-evidence-advisory-contract";
import type { AuthoritativeS80ImplementationEvidenceContext, CapaImplementationEvidenceAdvisoryReferenceManifestEntry } from "./capa-implementation-evidence-advisory-context";

/**
 * Binds model output to the server-resolved S70 action set and S80 draft.
 * This is intentionally separate from JSON-shape validation because these
 * authorities cannot be supplied by a model or browser payload.
 */
export function validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(response: CapaImplementationEvidenceAdvisoryResponse, context: AuthoritativeS80ImplementationEvidenceContext, manifest: readonly CapaImplementationEvidenceAdvisoryReferenceManifestEntry[]): boolean {
  const actions = new Set(context.approved_actions.map((action) => action.approved_action_reference));
  const evidenceById = new Map((context.workspace?.action_progress ?? []).flatMap((progress) => progress.evidence.map((evidence) => [evidence.evidence_id, evidence] as const)));
  const references = new Map(manifest.map((entry) => [entry.reference_key, entry]));
  for (const finding of response.findings) {
    if (!actions.has(finding.approved_action_reference)) return false;
    for (const evidenceId of finding.evidence_reference_ids) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence === undefined || evidence.approved_action_reference !== finding.approved_action_reference) return false;
    }
    for (const key of finding.reference_keys) {
      const reference = references.get(key);
      if (reference === undefined) return false;
      if (reference.source_kind === "implementation_evidence" && !evidenceById.has(reference.source_reference as never)) return false;
    }
    if (finding.adoption.eligible && (finding.adoption.field !== "implementation_narrative" || finding.adoption.suggested_value === null || finding.category !== "documentation_improvement")) return false;
    if (!finding.adoption.eligible && (finding.adoption.field !== null || finding.adoption.suggested_value !== null)) return false;
  }
  return response.citations.every((citation) => {
    const reference = references.get(citation.reference_key);
    return reference !== undefined && reference.source_kind === citation.source_kind && reference.source_reference === citation.source_reference && reference.source_status === citation.source_status && reference.locator === citation.locator;
  });
}
