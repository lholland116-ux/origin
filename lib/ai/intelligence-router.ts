export type IntelligenceRoute =
  | "standard"
  | "web_search"
  | "image_generation"
  | "image_editing";

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
    | "image_edit_not_executable"
    | "auto_web_search_required"
    | "existing_auto_web_classifier"
    | "default_standard";
};

export type IntelligenceRouteInput = {
  mode: IntelligenceRouterMode;
  prompt: string;
  hasImageContext: boolean;
  hasOtherAttachments?: boolean;
  /** Existing Auto mode decides web use inside /api/chat-web; this flag delegates to it. */
  deferAutoWebSearch?: boolean;
  /** Available to callers that already have a deterministic current-information signal. */
  autoWebSearchNeeded?: boolean;
};

const imageAnalysisIntent =
  /^\s*(?:please\s+)?(?:summari[sz]e|describe|read|explain|analy[sz]e|identify|what(?:\s+is|\s+does|'s)|tell\s+me)\b/i;

const imageEditIntent =
  /\b(?:remove|erase|replace|change|add|crop|edit|modify|transform|turn|convert|recolou?r|brighten|darken|blur|sharpen|retouch|restore|clean\s+up)\b/i;
const makeImageEditIntent =
  /\bmake\s+(?:this|the|that|my)\s+(?:image|picture|photo|photograph|illustration)\b/i;

const imageGenerationRequest =
  /^\s*(?:(?:please\s+)?(?:can|could|would)\s+you\s+|i\s+(?:want|need)\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+)?(?:please\s+)?(?:create|generate|draw|illustrate|render|design|make|sketch)\b/i;

const visualArtifact =
  /\b(?:image|picture|photo|illustration|diagram|render|poster|mockup|logo|artwork|visual|icon|graphic|chart|scene|portrait|wallpaper|cover|banner|map|infographic)\b/i;

export function hasImageEditIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  return Boolean(
      normalized &&
      !imageAnalysisIntent.test(normalized) &&
      (imageEditIntent.test(normalized) || makeImageEditIntent.test(normalized)),
  );
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

  const editIntent = hasImageEditIntent(input.prompt);
  if (editIntent) {
    if (input.hasImageContext && !input.hasOtherAttachments) {
      return { route: "image_editing", reason: "image_edit_intent" };
    }

    return { route: "standard", reason: "image_edit_not_executable" };
  }

  if (!input.hasOtherAttachments && hasImageGenerationIntent(input.prompt)) {
    return { route: "image_generation", reason: "image_generation_intent" };
  }

  if (input.autoWebSearchNeeded) {
    return { route: "web_search", reason: "auto_web_search_required" };
  }

  if (input.deferAutoWebSearch) {
    return { route: "web_search", reason: "existing_auto_web_classifier" };
  }

  return { route: "standard", reason: "default_standard" };
}
