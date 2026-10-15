import type { TemplateOutputFormat } from "@/lib/documents/generation/templates/types";

export type DocumentOutputFormatSelection =
  | Readonly<{ kind: "selected"; format: TemplateOutputFormat }>
  | Readonly<{ kind: "unsupported" | "conflict" }>;

const supportedFormatMap: Readonly<Record<string, TemplateOutputFormat>> = Object.freeze({
  txt: "txt",
  md: "md",
  markdown: "md",
  docx: "docx",
  pdf: "pdf",
  xlsx: "xlsx",
});

function outputIntentSegments(objective: string): string[] {
  const outputAction = /\b(?:create|generate|export|save|deliver|produce|make|provide|want|need|request|convert|turn)\b/gi;
  const actions = [...objective.matchAll(outputAction)];
  if (actions.length === 0) return [objective];

  return actions.map((action, index) => {
    const start = action.index ?? 0;
    const end = actions[index + 1]?.index ?? objective.length;
    let segment = objective.slice(start, end);
    const actionWord = action[0].toLowerCase();

    // In a conversion request, the destination follows "to" or "into".
    if (actionWord === "convert" || actionWord === "turn") {
      const destination = /\b(?:to|into)\b/i.exec(segment);
      if (destination) return segment.slice(destination.index);
    }

    // A format named as the source is not an output request.
    const sourceClause = /\b(?:from|using|based\s+(?:on|upon)|about|(?:for|of)\s+(?:the\s+)?(?:attached|uploaded|source|input))\b/i.exec(segment);
    if (sourceClause) segment = segment.slice(0, sourceClause.index);
    return segment;
  });
}

function formatMatches(segment: string): TemplateOutputFormat[] {
  const matches = [...segment.matchAll(/\b(txt|md|markdown|docx|pdf|xlsx)\b/gi)]
    .map((match) => supportedFormatMap[match[1]!.toLowerCase()]!);
  if (/\bword\s+(?:document|file|format)\b/i.test(segment)) matches.push("docx");
  if (/\b(?:plain\s+)?text\s+(?:file|document|format)\b/i.test(segment)) matches.push("txt");
  if (/\b(?:excel\s+(?:workbook|spreadsheet|file)|spreadsheet)\b/i.test(segment)) matches.push("xlsx");
  return matches;
}

export function selectDocumentOutputFormat(objective: string): DocumentOutputFormatSelection {
  const outputSegments = outputIntentSegments(objective);
  const unsupportedFormats = /\b(?:pptx|presentation|slides?|zip|archive)\b/gi;
  const outputAction = /\b(?:create|generate|export|save|deliver|produce|make|provide|want|need|request|convert|turn)\b/gi;
  for (const match of objective.matchAll(unsupportedFormats)) {
    const prefix = objective.slice(0, match.index);
    const clauseStart = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf("!"), prefix.lastIndexOf("?"), prefix.lastIndexOf(";")) + 1;
    const clause = prefix.slice(clauseStart);
    const actions = [...clause.matchAll(outputAction)];
    const action = actions.at(-1);
    if (!action) continue;
    const betweenActionAndFormat = clause.slice(action.index! + action[0].length);
    if (!/\b(?:from|using|based\s+on|about|for|of|with|analy[sz]e|review|summari[sz]e)\b/i.test(betweenActionAndFormat)) {
      return { kind: "unsupported" };
    }
  }

  const matches = outputSegments.flatMap(formatMatches);
  const unique = [...new Set(matches)];
  if (unique.length > 1) return { kind: "conflict" };
  return { kind: "selected", format: unique[0] ?? "pdf" };
}
