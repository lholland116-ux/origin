export type TaskComplexity = "single_step" | "multi_step";

const researchIntent =
  /\b(?:search|research|look\s+up|find\s+(?:current|latest)|latest|current|today|recent|up-to-date)\b/i;
const analysisIntent =
  /\b(?:analy[sz]e|review|inspect|examine|identify|extract|summari[sz]e)\b/i;
const artifactCreationIntent =
  /\b(?:create|generate|make|produce|prepare|export|build|turn|convert)\b.{0,100}\b(?:pdf|powerpoint|presentation|word(?:\s+document)?|docx|report|briefing|spreadsheet|excel|xlsx|document|artifact|file|downloadable)\b/i;

/**
 * Conservative structural signal only. Ambiguous requests remain on V1's
 * single-capability fast path; this classifier does not select or execute a route.
 */
export function classifyTaskComplexity(prompt: string): TaskComplexity {
  const normalized = prompt.trim();
  if (!normalized) return "single_step";

  const createsArtifact = artifactCreationIntent.test(normalized);
  if (
    createsArtifact &&
    (researchIntent.test(normalized) || analysisIntent.test(normalized))
  ) {
    return "multi_step";
  }

  return "single_step";
}

