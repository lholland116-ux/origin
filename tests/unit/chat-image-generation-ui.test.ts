import { readFileSync } from "node:fs";
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CHAT_ROUTING_MODE_LABELS,
  CHAT_REASONING_MODE_LABELS,
  COMPOSER_PLUS_MENU_LABELS,
  ChatRoutingModeSelector,
  ComposerPlusMenu,
  ReasoningModeSelector,
  getComposerPlusMenuActions,
  GeneratedImageAttribution,
  getGeneratedImageActionClass,
  getSelectedImageFiles,
  getProfileDisplayName,
  getUploadedMessageImageGridClass,
  handleComposerEnterKeyDown,
  isChatReasoningModeLocked,
  isCameraCaptureSupported,
} from "@/app/chat/ChatClient";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
type SelectorNode = ReactElement<{
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  id?: string;
}>;

function getRoutingMenu(selector: ReactElement): SelectorNode {
  const children = (selector as SelectorNode).props.children as (SelectorNode | false | null)[];
  return children.find(
    (child): child is SelectorNode => child !== false && child !== null &&
      child.props.id === "composer-routing-menu",
  )!;
}

function getRoutingOptions(menu: SelectorNode): SelectorNode[] {
  const children = menu.props.children as SelectorNode[];
  return (children[2]?.props.children as SelectorNode[]) ?? [];
}

function renderRoutingSelector(mode: "auto" | "standard" | "web_search", open = true): string {
  return renderToStaticMarkup(
    ChatRoutingModeSelector({
      mode,
      open,
      disabled: false,
      onToggle: () => undefined,
      onSelect: () => undefined,
    }),
  );
}

function getReasoningMenu(selector: ReactElement): SelectorNode {
  const children = (selector as SelectorNode).props.children as (SelectorNode | false | null)[];
  return children.find(
    (child): child is SelectorNode => child !== false && child !== null &&
      child.props.id === "composer-reasoning-menu",
  )!;
}

function getReasoningOptions(menu: SelectorNode): SelectorNode[] {
  const children = menu.props.children as SelectorNode[];
  const options = children.find((child) => child.props.id === "composer-reasoning-options")!;
  return options.props.children as SelectorNode[];
}

function renderPlusMenu(
  mode: "standard" | "web_search" | "create_image",
  cameraEnabled = false,
): string {
  return renderToStaticMarkup(
    ComposerPlusMenu({
      open: true,
      mode,
      disabled: false,
      cameraEnabled,
      onToggle: () => undefined,
      onAction: () => undefined,
    })
  );
}

function renderReasoningSelector(
  mode: "instant" | "medium" | "high",
  plan: "free" | "pro",
  open = true,
): string {
  return renderToStaticMarkup(
    ReasoningModeSelector({
      mode,
      plan,
      open,
      disabled: false,
      onToggle: () => undefined,
      onSelect: () => undefined,
    }),
  );
}

describe("chat image-generation presentation", () => {
  it("renders Auto, Standard, and Web Search with accessible help and explanations", () => {
    expect(CHAT_ROUTING_MODE_LABELS).toEqual({
      auto: "Auto",
      standard: "Standard",
      web_search: "Web Search",
    });

    const markup = renderRoutingSelector("auto");
    expect(markup).toContain('aria-label="Search mode: Auto"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Search mode options"');
    expect(markup).toContain("LVTChat decides when current web information is needed. Recommended.");
    expect(markup).toContain("Answers without searching the web.");
    expect(markup).toContain("Searches the web for current information.");
    expect(markup).toContain("Auto");
    expect(markup).toContain("Standard");
    expect(markup).toContain("Web Search");
    expect(markup).toContain("w-[78px]");
    expect(markup).toContain("sm:w-[136px]");
    expect(markup).toContain("sm:hidden");
    expect(markup).toContain("whitespace-nowrap sm:hidden");
    expect(markup).not.toContain("truncate");
    expect(renderRoutingSelector("standard")).toContain(">Standard</span>");
    expect(renderRoutingSelector("web_search")).toContain(">Web</span>");
  });

  it("makes closed routing help discoverable on hover and keyboard focus", () => {
    const markup = renderRoutingSelector("auto", false);
    expect(markup).toContain('aria-describedby="composer-routing-help"');
    expect(markup).toContain('id="composer-routing-help" role="tooltip"');
    expect(markup).toContain("Search mode");
    expect(markup).toContain("group-hover:opacity-100");
    expect(markup).toContain("group-focus-within:opacity-100");
  });

  it("dispatches each selected routing mode", () => {
    const onSelect = vi.fn();
    const selector = ChatRoutingModeSelector({
      mode: "auto",
      open: true,
      disabled: false,
      onToggle: () => undefined,
      onSelect,
    }) as ReactElement;
    const options = getRoutingOptions(getRoutingMenu(selector));

    for (const option of options) (option.props.onClick as () => void)();

    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenNthCalledWith(1, "auto");
    expect(onSelect).toHaveBeenNthCalledWith(2, "standard");
    expect(onSelect).toHaveBeenNthCalledWith(3, "web_search");
  });

  it("does not show search activity merely because Auto is selected", () => {
    const loadingStart = clientSource.indexOf("{loading && messages.length > 0 && (");
    const loadingEnd = clientSource.indexOf("<div ref={endRef}", loadingStart);
    const loadingStatus = clientSource.slice(loadingStart, loadingEnd);

    expect(loadingStatus).toContain('routingMode === "web_search"');
    expect(loadingStatus).not.toContain("useWebSearch\n");
  });

  it("renders the compact accessible selector and all three user-facing options", () => {
    expect(CHAT_REASONING_MODE_LABELS).toEqual({
      instant: "Instant",
      medium: "Medium",
      high: "High",
    });
    const markup = renderReasoningSelector("medium", "pro");

    expect(markup).toContain('aria-label="Reasoning mode: Medium"');
    expect(markup).toContain('aria-controls="composer-reasoning-menu"');
    expect(markup).toContain('aria-label="Reasoning mode options"');
    expect(markup).toContain("Fastest responses for simple questions and routine tasks.");
    expect(markup).toContain("Balanced speed and reasoning for most requests. Recommended.");
    expect(markup).toContain("More reasoning for complex problems, analysis, and multi-step tasks.");
    expect(markup).not.toContain("Pro only.");
    expect(markup).toContain("Instant");
    expect(markup).toContain("Medium");
    expect(markup).toContain("High");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("w-[78px]");
    expect(markup).toContain("sm:w-[122px]");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).not.toContain("truncate");
  });

  it("makes closed-selector help discoverable on hover and keyboard focus", () => {
    const markup = renderReasoningSelector("medium", "pro", false);

    expect(markup).toContain('aria-describedby="composer-reasoning-help"');
    expect(markup).toContain('id="composer-reasoning-help" role="tooltip"');
    expect(markup).toContain("Thinking level");
    expect(markup).toContain("Controls how much reasoning LVTChat uses before answering.");
    expect(markup).toContain("group-hover:opacity-100");
    expect(markup).toContain("group-focus-within:opacity-100");
  });

  it("keeps High visible but disabled and announced as Pro-locked for Free", () => {
    const markup = renderReasoningSelector("medium", "free");

    expect(markup).toContain(">High</span>");
    expect(markup).toContain("Pro only.");
    expect(markup).toContain("Locked. Pro plan required.");
    expect(isChatReasoningModeLocked("high", "free")).toBe(true);
    expect(isChatReasoningModeLocked("high", "pro")).toBe(false);
    expect(isChatReasoningModeLocked("medium", "free")).toBe(false);
  });

  it("dispatches selectable modes and does not dispatch locked Free High", () => {
    const onSelect = vi.fn();
    const selector = ReasoningModeSelector({
      mode: "medium",
      plan: "free",
      open: true,
      disabled: false,
      onToggle: () => undefined,
      onSelect,
    });
    const menu = getReasoningMenu(selector as ReactElement);
    const options = getReasoningOptions(menu);
    const instant = options.find((option) => option.key === "instant")!;
    const medium = options.find((option) => option.key === "medium")!;
    const high = options.find((option) => option.key === "high")!;

    (instant.props.onClick as () => void)();
    (medium.props.onClick as () => void)();
    (high.props.onClick as () => void)();

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("instant");
    expect(onSelect).toHaveBeenCalledWith("medium");
    expect(high.props.disabled).toBe(true);
  });

  it("allows Pro High and keeps the selector separate from the existing plus menu", () => {
    const onSelect = vi.fn();
    const selector = ReasoningModeSelector({
      mode: "medium",
      plan: "pro",
      open: true,
      disabled: false,
      onToggle: () => undefined,
      onSelect,
    });
    const menu = getReasoningMenu(selector as ReactElement);
    const high = getReasoningOptions(menu).find((option) => option.key === "high")!;

    expect(high.props.disabled).toBe(false);
    (high.props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith("high");

    const composerStart = clientSource.indexOf("<form");
    const composerEnd = clientSource.indexOf("</form>", composerStart);
    const composerSource = clientSource.slice(composerStart, composerEnd);
    expect(composerSource.indexOf("<ComposerPlusMenu")).toBeLessThan(
      composerSource.indexOf("<ChatRoutingModeSelector"),
    );
    expect(composerSource.indexOf("<ChatRoutingModeSelector")).toBeLessThan(
      composerSource.indexOf("<ReasoningModeSelector"),
    );
    expect(composerSource.indexOf("<ReasoningModeSelector")).toBeLessThan(
      composerSource.indexOf("TOOLTIP_TEXT.mic"),
    );
    expect(getComposerPlusMenuActions()).toEqual([
      "camera",
      "photos",
      "files",
      "create_image",
    ]);
    expect(composerSource).toContain("TOOLTIP_TEXT.mic");
    expect(composerSource).toContain('aria-label="Send your message"');
  });

  it("renders one compact conversation starter with the requested label", () => {
    expect(clientSource).toContain(
      'const CONVERSATION_STARTER = "Explain something step by step";'
    );
    expect(clientSource).not.toContain("CONVERSATION_STARTERS");
    expect(clientSource).not.toContain("Summarize this image or document for me");
    expect(clientSource).toContain("Try asking");
    expect(clientSource).toContain("handleConversationStarterClick(CONVERSATION_STARTER)");
    expect(clientSource).toContain("whitespace-nowrap rounded-lg px-3 py-2 text-sm");

    const starterBlockStart = clientSource.indexOf("{messages.length === 0 && (");
    const starterBlockEnd = clientSource.indexOf(
      '<div className="space-y-5 sm:space-y-6">',
      starterBlockStart
    );
    const starterBlock = clientSource.slice(starterBlockStart, starterBlockEnd);

    expect(starterBlock).toContain("Try asking");
    expect(starterBlock).toContain("CONVERSATION_STARTER");
    expect(starterBlock).not.toContain("Conversation starters");
  });

  it("keeps the empty-conversation safety notice compact and exact", () => {
    const emptyConversationStart = clientSource.indexOf("{messages.length === 0 && (");
    const emptyConversationEnd = clientSource.indexOf(
      '<div className="space-y-5 sm:space-y-6">',
      emptyConversationStart
    );
    const emptyConversationSource = clientSource.slice(
      emptyConversationStart,
      emptyConversationEnd
    );
    const safetyNoticeStart = emptyConversationSource.indexOf(
      '"mt-3 rounded-xl border px-3 py-2.5 text-sm"'
    );
    const safetyNoticeEnd = emptyConversationSource.indexOf(
      "\n                    </div>",
      safetyNoticeStart
    );
    const safetyNotice = emptyConversationSource.slice(
      safetyNoticeStart,
      safetyNoticeEnd
    );

    expect(emptyConversationSource).toContain("Do not share sensitive information.");
    expect(emptyConversationSource).not.toContain("Safety");
    expect(emptyConversationSource).not.toContain(
      "Do not share sensitive personal, medical, or confidential"
    );
    expect(safetyNotice.match(/\bborder\b/g)).toHaveLength(1);
    expect(safetyNotice).toContain("px-3 py-2.5");
    expect(safetyNotice).not.toContain("p-4");
    expect(safetyNotice).not.toContain("rounded-2xl border");
    expect(clientSource).toContain("setMessages([])");
    expect(clientSource).toContain("handleNewChat");
  });

  it("keeps the plus menu dedicated to attachment and image actions", () => {
    expect(getComposerPlusMenuActions()).toEqual([
      "camera",
      "photos",
      "files",
      "create_image",
    ]);
    expect(COMPOSER_PLUS_MENU_LABELS).toEqual({
      camera: "Camera",
      photos: "Photos",
      files: "Files",
      create_image: "Create image",
    });

    const standardMarkup = renderPlusMenu("standard");
    expect(standardMarkup.match(/role="menuitem"/g)).toHaveLength(4);
    expect(standardMarkup).toContain(">Camera</span>");
    expect(standardMarkup).toContain(">Photos</span>");
    expect(standardMarkup).toContain(">Files</span>");
    expect(standardMarkup).toContain(">Create image</span>");
    expect(standardMarkup.match(/disabled=""/g)).toHaveLength(1);

    const mobileStandardMarkup = renderPlusMenu("standard", true);
    expect(mobileStandardMarkup.match(/role="menuitem"/g)).toHaveLength(4);
    expect(mobileStandardMarkup).toContain(">Camera</span>");
    expect(mobileStandardMarkup).not.toContain('aria-disabled="true"');

    const webSearchMarkup = renderPlusMenu("web_search");
    expect(webSearchMarkup.match(/role="menuitem"/g)).toHaveLength(4);
    expect(webSearchMarkup).toContain(">Create image</span>");
    expect(webSearchMarkup.match(/disabled=""/g)).toHaveLength(3);
    expect(webSearchMarkup).not.toContain(">Standard</span>");
    expect(webSearchMarkup).not.toContain(">Web Search</span>");

    const createImageMarkup = renderPlusMenu("create_image");
    expect(createImageMarkup.match(/role="menuitem"/g)).toHaveLength(4);
    expect(createImageMarkup).toContain(">Camera</span>");
    expect(createImageMarkup).toContain(">Photos</span>");
    expect(createImageMarkup).toContain(">Files</span>");
    expect(createImageMarkup).not.toContain(">Standard</span>");
    expect(createImageMarkup).not.toContain(">Web Search</span>");

    expect(clientSource).toContain('aria-label="Open composer actions"');
    expect(clientSource).toContain('aria-haspopup="menu"');
    expect(clientSource).toContain('role="menu"');
    expect(clientSource).toContain("absolute bottom-full left-0 z-40");
    expect(clientSource).toContain("handleOpenImagePicker");
    expect(clientSource).toContain("handleOpenDocumentPicker");
    expect(clientSource).toContain("handleImageModeChange()");
    expect(clientSource).toContain("handleReturnToAutoChat");
    expect(clientSource).toContain('aria-label="Return to Auto text chat"');
    expect(clientSource).toContain("document.addEventListener(\"pointerdown\"");
    expect(clientSource).toContain('if (event.key !== "Escape") return;');
    expect(clientSource).toContain(
      'aria-label={isListening ? "Stop voice input" : "Start voice input"}'
    );
    expect(clientSource).not.toContain('aria-label="Attach image"');
    expect(clientSource).toContain("inputRef={documentInputRef}");

    const composerStart = clientSource.indexOf("<form");
    const composerEnd = clientSource.indexOf("</form>", composerStart);
    const composerSource = clientSource.slice(composerStart, composerEnd);
    expect(composerSource).toContain("<ComposerPlusMenu");
    expect(composerSource).toContain("overflow-visible rounded-2xl");
    expect(composerSource).not.toContain("overflow-hidden rounded-2xl");

    expect(clientSource).toContain(
      'const COMPOSER_RAIL_CLASS = "mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 min-w-0";'
    );
    const composerViewportStart = clientSource.indexOf(
      '<div className="sticky bottom-0 z-20">'
    );
    const composerViewportEnd = clientSource.indexOf(
      "<Tooltip content={TOOLTIP_TEXT.mic}",
      composerViewportStart
    );
    const composerViewportSource = clientSource.slice(
      composerViewportStart,
      composerViewportEnd
    );
    expect(composerViewportSource).toContain("COMPOSER_RAIL_CLASS");
    expect(composerViewportSource).not.toContain("CONTENT_RAIL_CLASS");
    expect(composerViewportSource).not.toContain("overflow-x-hidden");
  });

  it("uses the existing image pipeline for mobile camera capture and Photos", () => {
    expect(isCameraCaptureSupported("Mozilla/5.0 (Linux; Android 14)", false)).toBe(true);
    expect(isCameraCaptureSupported("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", false)).toBe(true);
    expect(isCameraCaptureSupported("Mozilla/5.0 (X11; Linux x86_64)", false)).toBe(false);
    expect(isCameraCaptureSupported("desktop-webview", true)).toBe(true);
    expect(getSelectedImageFiles(null)).toEqual([]);

    const cameraInputStart = clientSource.indexOf("ref={cameraInputRef}");
    const cameraInputEnd = clientSource.indexOf('className="hidden"', cameraInputStart);
    const cameraInputSource = clientSource.slice(cameraInputStart, cameraInputEnd);

    expect(cameraInputSource).toContain('type="file"');
    expect(cameraInputSource).toContain('accept="image/*"');
    expect(cameraInputSource).toContain('capture="environment"');
    expect(cameraInputSource).toContain("onChange={handleImageChange}");
    expect(clientSource).toContain("handleOpenCameraPicker");
    expect(clientSource).toContain('if (action === "camera")');
    expect(clientSource).toContain('if (action === "photos")');
    expect(clientSource).toContain("getSelectedImageFiles(event.target.files)");
    expect(clientSource).toContain("if (files.length === 0) return;");
    expect(clientSource).toContain("setPendingImages((current) => [...current, ...uploadedBatch])");
    expect(clientSource).toContain("previewUrl: uploaded.dataUrl");
    expect(clientSource).toContain("reconcileSubmittedImageMessage(");
    expect(clientSource).toContain('ref={imageInputRef}');
    expect(clientSource).toContain('onChange={handleImageChange}');
  });

  it("keeps uploaded image layouts intentional for one, two, and three images", () => {
    expect(getUploadedMessageImageGridClass(1)).toBe("grid-cols-1 sm:max-w-md");
    expect(getUploadedMessageImageGridClass(2)).toBe("grid-cols-2");
    expect(getUploadedMessageImageGridClass(3)).toBe("grid-cols-2 sm:grid-cols-3");
  });

  it("keeps generated images responsive and preloads only the latest candidate", () => {
    expect(clientSource).toContain('priority={isLatestMessage}');
    expect(clientSource).toContain('sizes="(max-width: 768px) calc(100vw - 2rem), 768px"');
    expect(clientSource).toContain("max-h-[min(70vh,640px)] max-w-full object-contain");
    expect(clientSource).toContain('aria-label="Download image"');
    expect(clientSource).toContain('aria-label="Regenerate image"');
  });

  it("keeps generated-image actions visible in Light without changing other themes", () => {
    expect(getGeneratedImageActionClass({ id: "light" }, "default")).toBe(
      "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
    );
    expect(getGeneratedImageActionClass({ id: "light" }, "delete")).toBe(
      "text-red-700 hover:bg-red-100 hover:text-red-900",
    );
    expect(getGeneratedImageActionClass({ id: "default-dark" }, "default")).toBe(
      "text-white/55 hover:bg-white/5 hover:text-white/90",
    );
    expect(getGeneratedImageActionClass({ id: "default-dark" }, "delete")).toBe(
      "text-red-300/65 hover:bg-red-400/10 hover:text-red-200",
    );
    for (const themeId of ["midnight-blue", "emerald", "purple", "warm-gray"]) {
      expect(getGeneratedImageActionClass({ id: themeId }, "default")).toBe(
        "text-white/55 hover:bg-white/5 hover:text-white/90",
      );
      expect(getGeneratedImageActionClass({ id: themeId }, "delete")).toBe(
        "text-red-300/65 hover:bg-red-400/10 hover:text-red-200",
      );
    }

    expect(clientSource).toContain('aria-label="Edit image"');
    expect(clientSource).toContain('aria-label="Download image"');
    expect(clientSource).toContain('aria-label="Regenerate image"');
    expect(clientSource).toContain('aria-label="Delete image"');
    expect(clientSource).toContain('getGeneratedImageActionClass(activeTheme, "default")');
    expect(clientSource).toContain('getGeneratedImageActionClass(activeTheme, "delete")');
    expect(clientSource).toContain('aria-label="Edit uploaded image"');
  });

  it("renders UI-only attribution for generated and edited result images", () => {
    const lightMarkup = renderToStaticMarkup(
      GeneratedImageAttribution({ theme: { id: "light" } })
    );
    const darkMarkup = renderToStaticMarkup(
      GeneratedImageAttribution({ theme: { id: "default-dark" } })
    );

    expect(lightMarkup).toContain("Created with LVTChat");
    expect(lightMarkup).toContain("text-slate-500");
    expect(darkMarkup).toContain("Created with LVTChat");
    expect(darkMarkup).toContain("text-white/50");

    const generatedResultStart = clientSource.indexOf("{message.generatedImage ? (");
    const generatedResultEnd = clientSource.indexOf(
      '{message.role === "assistant" && message.generatedImage?.id ? (',
      generatedResultStart
    );
    const generatedResultSource = clientSource.slice(generatedResultStart, generatedResultEnd);

    expect(generatedResultSource).toContain("<GeneratedImageAttribution theme={activeTheme} />");
    expect(generatedResultSource).toContain("src={message.generatedImage.url}");
    expect(
      clientSource.split("<GeneratedImageAttribution theme={activeTheme} />")
    ).toHaveLength(2);

    const uploadedImageStart = clientSource.indexOf(
      '{messageImageSource === "children" && messageImages.length > 0 ? ('
    );
    expect(clientSource.slice(uploadedImageStart, uploadedImageStart + 3600)).not.toContain(
      "GeneratedImageAttribution"
    );
  });

  it("keeps the existing usage refresh lifecycle for generation and regeneration", () => {
    expect(clientSource).toContain("await fetchUsage();");
    expect(clientSource).toContain("imageGenerationUsage.daily.remaining");
    expect(
      clientSource.match(/error instanceof ImageGenerationClientError && error\.status === 429/g),
    ).toHaveLength(2);
    expect(clientSource).not.toContain("daily.remaining > 20");
    expect(clientSource).not.toContain("monthly.remaining > 200");
  });

  it("renders an image quota warning once when the same safe error is also in uiError", () => {
    expect(clientSource).toContain(
      "!(isImageLimitReached && uiError === imageQuotaLimitMessage)",
    );
    expect(clientSource).toContain("{imageQuotaLimitMessage ??");
  });

  it("preserves generated-action ownership and uploaded-image rendering paths", () => {
    expect(clientSource).toContain(
      'message.role === "assistant" && message.generatedImage?.id',
    );
    expect(clientSource).toContain('messageImageSource === "children"');
    expect(clientSource).toContain('alt={image.image_name || "Uploaded image"}');
    expect(clientSource).toContain('alt={message.image_name || "Uploaded image"}');
  });

  it("keeps assistant replies borderless while retaining the user bubble border", () => {
    expect(clientSource).toContain(
      '"min-w-0 max-w-full rounded-xl p-3 break-words [overflow-wrap:anywhere]"',
    );
    expect(clientSource).not.toContain(
      '"min-w-0 max-w-full rounded-xl border p-3 break-words [overflow-wrap:anywhere]"',
    );
    expect(clientSource).toContain(
      '"max-w-full rounded-2xl border px-3 py-2.5 break-words [overflow-wrap:anywhere]"',
    );
    expect(clientSource).toContain(
      'message.role === "assistant" && message.generatedImage?.id',
    );
    expect(clientSource).toContain('endpoint: isStandard ? "/api/chat" : "/api/chat-web"');
    expect(clientSource).toContain('aria-label="Download image"');
    expect(clientSource).toContain('aria-label="Regenerate image"');
    expect(clientSource).toContain('alt={image.image_name || "Uploaded image"}');
    expect(clientSource).toContain('alt={message.image_name || "Uploaded image"}');
  });

  it("keeps mode and image actions out of the sidebar while preserving its core navigation", () => {
    const sidebarStart = clientSource.indexOf("function renderSidebarActions()");
    const sidebarEnd = clientSource.indexOf("function renderConversationRow", sidebarStart);
    const sidebarActions = clientSource.slice(sidebarStart, sidebarEnd);

    expect(sidebarActions).toContain("renderNewChatAction()");
    expect(sidebarActions).not.toContain("Standard");
    expect(sidebarActions).not.toContain("Web Search");
    expect(sidebarActions).not.toContain("Create image");
    expect(clientSource).toContain("Chat History");
    expect(clientSource).toContain('aria-label="Open profile and settings"');
    expect(clientSource).toContain("{renderSidebarActions()}");
    expect(clientSource).toContain("{renderSidebarUtilityActions(true)}");
    expect(clientSource).toContain('href="/help"');
    expect(clientSource).toContain('className="flex h-12 shrink-0 items-center px-3 md:hidden"');
    expect(clientSource).toContain('aria-label="Open menu"');
    expect(clientSource).not.toContain("headerProfileTriggerRef");
    expect(clientSource).not.toContain('z-20 border-b backdrop-blur');
    expect(clientSource).toContain("overflow-x-hidden");
  });

  it("uses a bounded mobile drawer while preserving the desktop sidebar width", () => {
    const mobileDrawerStart = clientSource.indexOf(
      '<div className="fixed inset-0 z-50 flex md:hidden">',
    );
    const mobileDrawerEnd = clientSource.indexOf(
      "        {renderProfileSettingsMenu()}",
      mobileDrawerStart,
    );
    const mobileDrawerSource = clientSource.slice(mobileDrawerStart, mobileDrawerEnd);

    expect(mobileDrawerSource).toContain("w-[min(18rem,78vw)]");
    expect(mobileDrawerSource).toContain("max-w-[calc(100vw-1rem)]");
    expect(mobileDrawerSource).toContain("min-w-0");
    expect(mobileDrawerSource).toContain("overflow-hidden");
    expect(mobileDrawerSource).not.toContain("w-80");
    expect(clientSource).toContain(
      'hidden h-full w-64 shrink-0 border-r md:flex md:flex-col',
    );
    expect(mobileDrawerSource).toContain("{renderSidebarUtilityActions(true)}");
  });

  it("normalizes sidebar action labels to the Chat History typography", () => {
    const profileMenuStart = clientSource.indexOf("function renderProfileSettingsMenu");
    const sidebarActionsStart = clientSource.indexOf("function renderSidebarActions");
    const profileMenuSource = clientSource.slice(profileMenuStart, sidebarActionsStart);
    const newChatStart = clientSource.indexOf("function renderNewChatAction");
    const sidebarUtilityStart = clientSource.indexOf("function renderSidebarUtilityActions");
    const newChatSource = clientSource.slice(newChatStart, sidebarUtilityStart);

    expect(clientSource).toContain('const SIDEBAR_LABEL_CLASS = "text-sm font-medium";');
    expect(clientSource).toContain(
      '<div className="truncate text-sm font-medium">{conversationTitle}</div>',
    );
    expect(newChatSource).toContain("SIDEBAR_LABEL_CLASS");
    expect(newChatSource).toContain("min-h-12 w-full");
    expect(clientSource).not.toContain("function renderSidebarModeActions");
    expect(profileMenuSource).toContain("SIDEBAR_LABEL_CLASS");
    expect(profileMenuSource).toContain("Theme");
    expect(profileMenuSource).toContain("Help");
    expect(profileMenuSource).toContain("Account");
    expect(profileMenuSource).toContain("Upgrade to Pro");
    expect(profileMenuSource).toContain("Sign Out");
    expect(profileMenuSource).toContain("px-3 py-2");
  });

  it("removes persistent usage counters while preserving quota enforcement", () => {
    const composerStart = clientSource.indexOf("<form");
    const composerEnd = clientSource.indexOf("</form>", composerStart);
    const composerSource = clientSource.slice(composerStart, composerEnd);

    expect(clientSource).not.toContain("renderMessageUsage");
    expect(clientSource).not.toContain("renderImageGenerationUsage");
    expect(clientSource).not.toContain('aria-label="Message usage"');
    expect(clientSource).not.toContain('aria-label="Image generation usage"');
    expect(clientSource).not.toContain("messages left today");
    expect(clientSource).not.toContain("images left today");
    expect(clientSource).toContain("const isTextLimitReached = Boolean(");
    expect(clientSource).toContain("const isLimitReached = useImageGeneration");
    expect(clientSource).toContain("imageGenerationUsage.daily.remaining");
    expect(clientSource).toContain("imageQuotaLimitMessage");
    expect(clientSource).toContain("getImageGenerationQuotaMessage(");
    expect(clientSource).toContain("fetchUsage");
    expect(clientSource).toMatch(
      /!useImageGeneration\s*&&\s*usage\s*&&\s*usage\.remaining > 0\s*&&\s*usage\.remaining <= 5/,
    );
    expect(clientSource).toContain("Only {usage.remaining} messages remaining today");
    expect(composerSource).toContain("<DocumentUploadButton");
    expect(composerSource).not.toContain('aria-label="Attach image"');
    expect(composerSource).toContain(
      'aria-label={isListening ? "Stop voice input" : "Start voice input"}',
    );
    expect(composerSource).toContain("<div className=\"ml-auto\">");
    expect(clientSource).toContain("Standard");
    expect(clientSource).toContain("Web Search");
    expect(clientSource).toContain("Create image");

    const mobileTopStart = clientSource.indexOf("<div data-profile-sidebar");
    const mobileTopEnd = clientSource.indexOf("{renderSidebarActions()}", mobileTopStart);
    const mobileTopSource = clientSource.slice(mobileTopStart, mobileTopEnd);
    const desktopTopStart = clientSource.indexOf("<aside data-profile-sidebar");
    const desktopTopEnd = clientSource.indexOf("{renderSidebarActions()}", desktopTopStart);
    const desktopTopSource = clientSource.slice(desktopTopStart, desktopTopEnd);

    expect(mobileTopSource).not.toContain("messages used today");
    expect(mobileTopSource).not.toContain("Free Plan");
    expect(mobileTopSource).not.toContain("Pro Plan");
    expect(desktopTopSource).not.toContain("messages used today");
    expect(desktopTopSource).not.toContain("Free Plan");
    expect(desktopTopSource).not.toContain("Pro Plan");
  });

  it("removes the conversation document counter without changing composer uploads", () => {
    expect(clientSource).not.toContain("documents in this conversation");
    expect(clientSource).not.toContain("conversationDocuments");
    expect(clientSource).toContain("<form");
    expect(clientSource).toContain("<textarea");
    expect(clientSource).not.toContain("messages left today");
    expect(clientSource).not.toContain("images left today");
    expect(clientSource).toContain("<DocumentUploadButton");
    expect(clientSource).toContain('plan === "pro"');
    expect(clientSource).toContain('"/api/documents/upload"');
    expect(clientSource).toContain("File uploads are a Pro feature");
    expect(clientSource).not.toContain('aria-label="Attach image"');
  });

  it("emphasizes profile identity and Chat History with existing theme tokens", () => {
    expect(getProfileDisplayName("jane.doe@example.com")).toBe("Jane Doe");

    const profileTriggerStart = clientSource.indexOf("function renderSidebarUtilityActions");
    const profileMenuStart = clientSource.indexOf("function renderProfileSettingsMenu");
    const sidebarStart = clientSource.indexOf("function renderSidebarActions", profileMenuStart);
    const profileTriggerSource = clientSource.slice(profileTriggerStart, profileMenuStart);
    const profileMenuSource = clientSource.slice(profileMenuStart, sidebarStart);

    expect(profileTriggerSource).toContain(
      'activeTheme.titleText',
    );
    expect(profileTriggerSource).toContain("activeTheme.mutedText");
    expect(profileMenuSource).toContain("getProfileDisplayName(userEmail)");
    expect(profileMenuSource).toContain("activeTheme.titleText");
    expect(profileMenuSource).toContain("activeTheme.titleText");
    expect(profileMenuSource).toContain("mt-0.5 text-xs");
    expect(clientSource).toContain("activeTheme.badge");
    expect(clientSource).toContain("bg-white/[0.08] text-white");
  });

  it("constrains the profile menu to the active sidebar or mobile drawer", () => {
    const profileMenuStart = clientSource.indexOf("function renderProfileSettingsMenu");
    const profileMenuEnd = clientSource.indexOf("function renderSidebarActions", profileMenuStart);
    const profileMenuSource = clientSource.slice(profileMenuStart, profileMenuEnd);

    expect(clientSource).toContain('trigger.closest<HTMLElement>("[data-profile-sidebar]")');
    expect(clientSource).toContain("PROFILE_MENU_HORIZONTAL_INSET");
    expect(clientSource).toContain("width: rect.width - PROFILE_MENU_HORIZONTAL_INSET * 2");
    expect(profileMenuSource).toContain("profileMenuPosition.width || undefined");
    expect(profileMenuSource).toContain("max-w-[calc(100vw-1.5rem)]");
    expect(profileMenuSource).not.toContain("w-[min(22rem,calc(100vw-1.5rem))]");
    expect(profileMenuSource).not.toContain("overflow-hidden");
    expect(clientSource).toContain("<div data-profile-sidebar");
    expect(clientSource).toContain("<aside data-profile-sidebar");
    expect(clientSource).toContain("setProfileMenuOpen(true)");
    expect(clientSource).toContain("handleOutsidePointerDown");
    expect(clientSource).toContain('if (event.key === "Escape")');
    expect(clientSource).toContain("w-[min(18rem,78vw)]");
    expect(clientSource).toContain(
      'hidden h-full w-64 shrink-0 border-r md:flex md:flex-col',
    );
  });

  it("keeps theme choices readable inside the narrow profile menu", () => {
    const themePickerStart = clientSource.indexOf("function ChatThemePicker");
    const themePickerEnd = clientSource.indexOf("function SourcesDisclosure", themePickerStart);
    const themePickerSource = clientSource.slice(themePickerStart, themePickerEnd);

    expect(themePickerSource).toContain('aria-label="Chat theme picker"');
    expect(themePickerSource).toContain("grid grid-cols-1 gap-1");
    expect(themePickerSource).toContain("min-h-10 w-full");
    expect(themePickerSource).toContain("getChatThemeFocusOffsetClass(theme)");
    expect(themePickerSource).toContain("getChatThemeHoverClass(theme)");
    expect(themePickerSource).toContain("SIDEBAR_LABEL_CLASS");
    expect(themePickerSource).toContain("item.pageBg");
    expect(themePickerSource).toContain("item.assistantBubble");
    expect(themePickerSource).toContain("item.userBubble");
    expect(themePickerSource).toContain("aria-pressed={active}");
    expect(themePickerSource).toContain("onChange(item.id)");
    expect(themePickerSource).not.toContain("sm:grid-cols-2");
    expect(themePickerSource).not.toContain("xl:grid-cols-3");
    expect(themePickerSource).not.toContain("max-h-[calc(100dvh-310px)]");
    expect(themePickerSource).not.toContain("overflow-y-auto");
  });

  it("keeps conversation history actions visible in Light", () => {
    const rowStart = clientSource.indexOf("function ConversationRow");
    const rowEnd = clientSource.indexOf("const MAX_INLINE_INPUT_LENGTH", rowStart);
    const rowSource = clientSource.slice(rowStart, rowEnd);

    expect(rowSource).toContain("More actions for");
    expect(rowSource).toContain("theme.id === \"light\"");
    expect(rowSource).toContain("text-slate-700 hover:bg-slate-100 hover:text-slate-950");
    expect(rowSource).toContain("bg-slate-200 text-slate-900");
    expect(rowSource).toContain("onRename();");
    expect(rowSource).toContain("onDelete();");
  });

  it("keeps one visible themed microphone control in the final composer", () => {
    const micStart = clientSource.indexOf(
      '<Tooltip theme={activeTheme} content={TOOLTIP_TEXT.mic}>'
    );
    const micEnd = clientSource.indexOf("</Tooltip>", micStart);
    const micSource = clientSource.slice(micStart, micEnd);

    expect(micStart).toBeGreaterThanOrEqual(0);
    expect(micSource).toContain("disabled={micDisabled}");
    expect(micSource).toContain("handleStartListening");
    expect(micSource).toContain("handleStopListening");
    expect(micSource).toContain("activeTheme.inputBg");
    expect(micSource).toContain("activeTheme.inputBorder");
    expect(micSource).toContain("activeTheme.inputText");
    expect(micSource).toContain("getChatThemeHoverClass(activeTheme)");
    expect(clientSource.match(/<Mic className="h-5 w-5" \/>/g)).toHaveLength(1);
    expect(clientSource).not.toContain('aria-label="Attach image"');
    expect(clientSource.indexOf("<ComposerPlusMenu")).toBeLessThan(micStart);
    expect(micStart).toBeLessThan(clientSource.indexOf('aria-label="Send your message"'));
    expect(clientSource).toContain(
      "window.SpeechRecognition || window.webkitSpeechRecognition"
    );
    expect(clientSource).toContain("setSpeechSupported(false)");
  });

  it("submits the existing form on plain Enter", () => {
    const requestSubmit = vi.fn();
    const preventDefault = vi.fn();
    const event = {
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false },
      currentTarget: { form: { requestSubmit } },
      preventDefault,
    } as unknown as ReactKeyboardEvent<HTMLTextAreaElement>;

    handleComposerEnterKeyDown(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("leaves Shift+Enter to insert a newline", () => {
    const requestSubmit = vi.fn();
    const preventDefault = vi.fn();
    const event = {
      key: "Enter",
      shiftKey: true,
      nativeEvent: { isComposing: false },
      currentTarget: { form: { requestSubmit } },
      preventDefault,
    } as unknown as ReactKeyboardEvent<HTMLTextAreaElement>;

    handleComposerEnterKeyDown(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it("leaves Enter during IME composition to the input method", () => {
    const requestSubmit = vi.fn();
    const preventDefault = vi.fn();
    const event = {
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: true },
      currentTarget: { form: { requestSubmit } },
      preventDefault,
    } as unknown as ReactKeyboardEvent<HTMLTextAreaElement>;

    handleComposerEnterKeyDown(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it("keeps keyboard and Send button on the same safeguarded form path", () => {
    const formStart = clientSource.indexOf("<form");
    const formEnd = clientSource.indexOf("</form>", formStart);
    const composerSource = clientSource.slice(formStart, formEnd);
    const textareaStart = composerSource.indexOf("<textarea");
    const textareaEnd = composerSource.indexOf("/>", textareaStart);
    const textareaSource = composerSource.slice(textareaStart, textareaEnd);

    expect(composerSource).toContain("onSubmit={handleSubmit}");
    expect(textareaSource).toContain("onKeyDown={handleComposerEnterKeyDown}");
    expect(composerSource).toMatch(/<button\s+type="submit"[\s\S]*?aria-label="Send your message"/);
    expect(composerSource).toContain("composerDisabled ||");
    expect(composerSource).toContain("pendingImageLimitExceeded ||");
    expect(composerSource).toContain("!canSubmitWithPendingImages(");
    expect(clientSource).toContain("if (loading || uploadingImages || isUploadingDocuments) return;");
    expect(clientSource).toContain("if (pendingDocumentLimitExceeded) {");
    expect(clientSource).toContain("if (isLimitReached) {");
    expect(clientSource).toContain("if (!trimmed && !hasImages) {");
    expect(composerSource).toContain("onPaste={handleComposerPaste}");
    expect(composerSource).toContain("<DocumentUploadButton");
    expect(composerSource).toContain("onFilesSelected={handleFilesSelected}");
    expect(clientSource).toContain("form?.requestSubmit()");
    expect(clientSource).toContain("event.nativeEvent.isComposing");
  });
});
