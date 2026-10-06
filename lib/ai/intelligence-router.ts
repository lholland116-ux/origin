export type IntelligenceRoute =
  | "standard"
  | "web_search"
  | "image_generation"
  | "image_editing"
  | "file_analysis"
  | "document_generation";

export type IntelligenceRouterMode =
  | "auto"
  | "standard"
  | "web_search"
  | "create_image";

export type IntelligenceRouteDecision = {
  route: IntelligenceRoute;
  reason:
    | "explicit_standard"
    | "explicit_web_search"
    | "explicit_create_image"
    | "image_edit_intent"
    | "image_generation_intent"
    | "document_generation_intent"
    | "file_analysis_intent"
    | "attachment_safe_fallback"
    | "image_edit_not_executable"
    | "auto_web_search_required"
    | "existing_auto_web_classifier"
    | "default_standard";
};

export type IntelligenceRouteInput = {
  mode: IntelligenceRouterMode;
  prompt: string;
  /** Passive historical image availability; it does not imply the user selected Edit. */
  hasImageContext: boolean;
  hasImageAttachment?: boolean;
  hasDocumentAttachment?: boolean;
  hasOtherAttachments?: boolean;
  /** Existing Auto mode decides web use inside /api/chat-web; this flag delegates to it. */
  deferAutoWebSearch?: boolean;
  /** Available to callers that already have a deterministic current-information signal. */
  autoWebSearchNeeded?: boolean;
};

const imageAnalysisIntent =
  /^\s*(?:please\s+)?(?:summari[sz]e|describe|read|explain|analy[sz]e|identify|what(?:\s+is|\s+does|'s)|tell\s+me)\b/i;

const imageEditRequestPrefix =
  /^\s*(?:(?:can|could|would)\s+you(?:\s+please)?\s+|i\s+(?:want|need)\s+you\s+to(?:\s+please)?\s+|i(?:'d|\s+would)\s+like\s+you\s+to(?:\s+please)?\s+|please\s+)?/i;
const imageEditIntent =
  /^\s*(?:remove|erase|replace|change|add|crop|edit|modify|transform|recolou?r|brighten|darken|blur|sharpen|retouch|restore|clean\s+up)\s+(?!(?:is|are|was|were|be|being|been|happens?|happened|occurs?|occurred|means?|refers?|can|could|would|should|may|might|must|will|shall)\b)\S+/i;
const makeImageEditIntent =
  /^\s*make\s+(?:this|the|that|my)\s+(?:image|picture|photo|photograph|illustration)\b|^\s*make\s+it\s+(?:blue|red|green|yellow|black|white|brighter|darker|larger|smaller|cleaner|warmer|cooler)\b|^\s*make\s+(?:the|this|that|my)\s+[\w -]{1,50}\s+(?:blue|red|green|yellow|black|white|brighter|darker|larger|smaller|cleaner|warmer|cooler)\b/i;
const transformImageEditIntent =
  /^\s*(?:turn|convert)\b.{0,40}\b(?:image|picture|photo|photograph)\b|^\s*(?:turn|convert)\s+(?:this|it)\s+into\s+(?:a\s+)?(?:watercolor|painting|sketch|illustration|cartoon|oil\s+painting)\b/i;
const passiveImageEditEvidence =
  /\b(?:(?:this|that|attached|selected)\s+(?:image|picture|photo|photograph|illustration|screenshot)|the\s+(?:image|picture|photo|photograph|illustration|screenshot)\s+(?:above|below|you\s+(?:made|created|generated))|(?:generated|created)\s+(?:image|picture|photo|photograph)|(?:image|picture|photo|photograph)\s+background|sky|walls?|trees?|sunglasses|glasses|face|hair|clothing|beach|ocean|sea|mountain|forest|landscape)\b/i;

const imageGenerationRequest =
  /^\s*(?:(?:please\s+)?(?:can|could|would)\s+you\s+|i\s+(?:want|need)\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+)?(?:please\s+)?(?:create|generate|draw|illustrate|render|design|make|sketch)\b/i;

const visualArtifact =
  /\b(?:image|picture|photo|illustration|diagram|render|poster|mockup|logo|artwork|visual|icon|graphic|chart|scene|portrait|wallpaper|cover|banner|map|infographic)\b/i;

const documentGenerationAction =
  /^\s*(?:(?:please\s+)?(?:can|could|would)\s+you\s+|i\s+(?:want|need)\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+)?(?:please\s+)?(?:create|generate|make|produce|build|export|prepare|save|turn|convert|package)\b/i;
const documentArtifact =
  /\b(?:txt|text\s+file|markdown|md|docx|word(?:\s+document)?|pdf|xlsx|excel(?:\s+(?:spreadsheet|workbook))?|pptx|powerpoint|presentation|zip|document|report|spreadsheet|file)\b/i;
const informationalDocumentQuestion =
  /^\s*(?:what\s+is|what\s+does|explain|how\s+(?:do|can)\s+i|can\s+.+\s+open)\b/i;
const fileAnalysisIntent =
  /^\s*(?:please\s+)?(?:analy[sz]e|summari[sz]e|review|inspect|examine|describe|explain|identify|extract|read|find|compare|list|interpret)\b/i;
const requestedFileAnalysisIntent =
  /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:analy[sz]e|summari[sz]e|review|inspect|examine|describe|explain|identify|extract|read|find|compare|list|interpret)\b|\bwhat\s+(?:is|are|does|do|shows?|shown)|\bmajor\s+trends?|\bkey\s+findings?\b/i;
const currentInformationIntent =
  /\b(?:latest|current(?:ly)?|today|right\s+now|as\s+of\s+now|recent(?:ly)?|up[ -]to[ -]date|this\s+(?:week|month|year))\b/i;

export function hasDocumentGenerationIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  return Boolean(
    normalized &&
      !informationalDocumentQuestion.test(normalized) &&
      documentGenerationAction.test(normalized) &&
      documentArtifact.test(normalized),
  );
}

export function hasFileAnalysisIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  return fileAnalysisIntent.test(normalized) || requestedFileAnalysisIntent.test(normalized);
}

export function hasCurrentInformationIntent(prompt: string): boolean {
  return currentInformationIntent.test(prompt.trim());
}

export function hasImageEditIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  const requestedAction = normalized.replace(imageEditRequestPrefix, "");
  return Boolean(
    normalized &&
      !imageAnalysisIntent.test(normalized) &&
      (imageEditIntent.test(requestedAction) ||
        makeImageEditIntent.test(requestedAction) ||
        transformImageEditIntent.test(requestedAction)),
  );
}

function hasPassiveImageEditIntent(prompt: string): boolean {
  return hasImageEditIntent(prompt) && passiveImageEditEvidence.test(prompt);
}

export function hasImageGenerationIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  return Boolean(
    normalized &&
      !imageAnalysisIntent.test(normalized) &&
      imageGenerationRequest.test(normalized) &&
      visualArtifact.test(normalized),
  );
}

export function selectIntelligenceRoute(
  input: IntelligenceRouteInput,
): IntelligenceRouteDecision {
  if (input.mode === "standard") {
    return { route: "standard", reason: "explicit_standard" };
  }

  if (input.mode === "web_search") {
    return { route: "web_search", reason: "explicit_web_search" };
  }

  if (input.mode === "create_image") {
    return { route: "image_generation", reason: "explicit_create_image" };
  }

  const hasImageAttachment = input.hasImageAttachment === true;
  const hasDocumentAttachment = input.hasDocumentAttachment === true;
  const hasAnyAttachment =
    input.hasOtherAttachments === true || hasImageAttachment || hasDocumentAttachment;

  const editIntent = hasImageEditIntent(input.prompt);
  if (editIntent) {
    if (
      hasImageAttachment &&
      !hasDocumentAttachment &&
      !input.hasOtherAttachments
    ) {
      return { route: "image_editing", reason: "image_edit_intent" };
    }

    if (
      input.hasImageContext &&
      !hasDocumentAttachment &&
      !input.hasOtherAttachments &&
      hasPassiveImageEditIntent(input.prompt)
    ) {
      return { route: "image_editing", reason: "image_edit_intent" };
    }

    if (!input.hasImageContext || hasDocumentAttachment || input.hasOtherAttachments) {
      return { route: "standard", reason: "image_edit_not_executable" };
    }

    // Historical availability alone is insufficient; let ordinary routing continue.
  }

  if (
    !hasAnyAttachment &&
    !(input.hasImageContext && editIntent) &&
    hasImageGenerationIntent(input.prompt)
  ) {
    return { route: "image_generation", reason: "image_generation_intent" };
  }

  if (hasDocumentGenerationIntent(input.prompt)) {
    return { route: "document_generation", reason: "document_generation_intent" };
  }

  if (
    (hasImageAttachment || hasDocumentAttachment) &&
    hasFileAnalysisIntent(input.prompt)
  ) {
    return { route: "file_analysis", reason: "file_analysis_intent" };
  }

  if (input.autoWebSearchNeeded && !hasImageAttachment) {
    return { route: "web_search", reason: "auto_web_search_required" };
  }

  if (hasImageAttachment || hasDocumentAttachment) {
    return { route: "standard", reason: "attachment_safe_fallback" };
  }

  if (input.deferAutoWebSearch) {
    return { route: "web_search", reason: "existing_auto_web_classifier" };
  }

  return { route: "standard", reason: "default_standard" };
}
