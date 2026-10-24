import { describe, expect, it, vi } from "vitest";
import {
  buildChatRequest,
  fetchChatResponse,
  fetchGeneratedImage,
  resolveComposerRoutingMode,
} from "@/app/chat/ChatClient";
import { selectIntelligenceRoute } from "@/lib/ai/intelligence-router";
import {
  composerRoutingDiagnostic,
  getClientBuildId,
  parseRoutingDiagnostic,
  regenerateImageRoutingDiagnostic,
  ROUTING_DIAGNOSTIC_HEADER,
} from "@/lib/chat/routing-diagnostic";
import { NURSING_SATA_JSON_PROMPT } from "@/tests/fixtures/nursing-sata-json-prompt";
import { setNavigationBuildId } from "next/dist/client/navigation-build-id";

const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const BUILD_ID = "wzQr8EK8PWK0vnKVRARhN";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const NURSING_PROMPT =
  "generate 20 questions all that apply with rationales in Json format for LPN Fundamentals of Nursing";

async function dispatchComposer(
  prompt: string,
  createImageSelected: boolean,
  fetcher: typeof fetch,
) {
  const mode = resolveComposerRoutingMode(createImageSelected, prompt);
  const route = selectIntelligenceRoute({
    mode,
    prompt,
    hasImageContext: false,
    deferAutoWebSearch: true,
  });
  const diagnostic = composerRoutingDiagnostic({
    selectedMode: createImageSelected ? "create_image" : "auto",
    route,
    clientBuildId: BUILD_ID,
    requestId: REQUEST_ID,
  });

  if (route.route === "image_generation") {
    await fetchGeneratedImage(prompt, {
      conversationId: CONVERSATION_ID,
      fetcher,
      createObjectUrl: () => "blob:test-image",
      routingDiagnostic: diagnostic,
    });
  } else {
    const request = buildChatRequest({
      conversationId: CONVERSATION_ID,
      message: prompt,
      generationRequestId: REQUEST_ID,
      documentIds: [],
      reasoningMode: "medium",
      routingMode: "auto",
      route: route.route,
      hasImages: false,
      images: [],
    });
    await fetchChatResponse(request, { fetcher, routingDiagnostic: diagnostic });
  }
  return diagnostic;
}

function mockResponse(url: RequestInfo | URL): Promise<Response> {
  if (url === "/api/image-generation") {
    return Promise.resolve(new Response(new Uint8Array([1]), {
      headers: {
        "Content-Type": "image/webp",
        "X-LVTChat-Image-Provider": "replicate",
        "X-LVTChat-Image-Model": "black-forest-labs/flux-schnell",
      },
    }));
  }
  return Promise.resolve(new Response("Text response"));
}

describe("chat routing diagnostics", () => {
  it("dispatches the full nursing SATA JSON request through the text endpoint in Auto", async () => {
    const fetcher = vi.fn(mockResponse) as typeof fetch;
    const diagnostic = await dispatchComposer(NURSING_SATA_JSON_PROMPT, false, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/chat-web", expect.any(Object));
    expect(diagnostic).toMatchObject({
      entry_point: "composer_submit",
      selected_mode: "auto",
      resolved_mode: "text",
      route_reason: "existing_auto_web_classifier",
    });
    const request = vi.mocked(fetcher).mock.calls[0]?.[1];
    expect(parseRoutingDiagnostic(new Headers(request?.headers).get(ROUTING_DIAGNOSTIC_HEADER)))
      .toEqual(diagnostic);
    expect(JSON.parse(String(request?.body))).toMatchObject({
      message: NURSING_SATA_JSON_PROMPT,
      generationRequestId: REQUEST_ID,
    });
  });

  it("sends the nursing JSON request to text with a composer diagnostic", async () => {
    const fetcher = vi.fn(mockResponse) as typeof fetch;
    const diagnostic = await dispatchComposer(NURSING_PROMPT, true, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/chat-web", expect.any(Object));
    expect(diagnostic).toMatchObject({
      entry_point: "composer_submit",
      selected_mode: "create_image",
      resolved_mode: "text",
      route_reason: "existing_auto_web_classifier",
    });
    expect(parseRoutingDiagnostic(new Headers((vi.mocked(fetcher).mock.calls[0]?.[1])?.headers)
      .get(ROUTING_DIAGNOSTIC_HEADER))).toEqual(diagnostic);
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body)))
      .toMatchObject({ message: NURSING_PROMPT, generationRequestId: REQUEST_ID });
  });

  it("sends an explicit image request to the image endpoint with its route reason", async () => {
    const fetcher = vi.fn(mockResponse) as typeof fetch;
    const diagnostic = await dispatchComposer("Generate an image of a nurse teaching.", false, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/image-generation", expect.any(Object));
    expect(diagnostic).toMatchObject({
      entry_point: "composer_submit",
      selected_mode: "auto",
      resolved_mode: "image",
      route_reason: "image_generation_intent",
    });
    expect(parseRoutingDiagnostic(new Headers((vi.mocked(fetcher).mock.calls[0]?.[1])?.headers)
      .get(ROUTING_DIAGNOSTIC_HEADER))).toEqual(diagnostic);
  });

  it("marks Regenerate Image separately while preserving the image request body", async () => {
    const fetcher = vi.fn(mockResponse) as typeof fetch;
    const diagnostic = regenerateImageRoutingDiagnostic({
      selectedMode: "auto",
      clientBuildId: BUILD_ID,
      requestId: REQUEST_ID,
    });

    await fetchGeneratedImage("A mountain lake", {
      conversationId: CONVERSATION_ID,
      fetcher,
      createObjectUrl: () => "blob:test-image",
      routingDiagnostic: diagnostic,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/image-generation", expect.any(Object));
    const init = vi.mocked(fetcher).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      conversationId: CONVERSATION_ID,
      prompt: "A mountain lake",
    });
    expect(parseRoutingDiagnostic(new Headers(init?.headers).get(ROUTING_DIAGNOSTIC_HEADER)))
      .toMatchObject({ entry_point: "regenerate_image", route_reason: "regenerate_image" });
  });

  it.each([false, true])(
    "routes image followed by nursing JSON to text when Create Image remains selected: %s",
    async (createImageSelected) => {
      const fetcher = vi.fn(mockResponse) as typeof fetch;
      const imageDiagnostic = await dispatchComposer("A mountain lake", true, fetcher);
      const diagnostic = await dispatchComposer(NURSING_SATA_JSON_PROMPT, createImageSelected, fetcher);

      expect(vi.mocked(fetcher).mock.calls.map(([url]) => url))
        .toEqual(["/api/image-generation", "/api/chat-web"]);
      expect(imageDiagnostic).toMatchObject({
        entry_point: "composer_submit",
        selected_mode: "create_image",
        resolved_mode: "image",
        route_reason: "explicit_create_image",
      });
      expect(diagnostic).toMatchObject({
        entry_point: "composer_submit",
        selected_mode: createImageSelected ? "create_image" : "auto",
        resolved_mode: "text",
        route_reason: "existing_auto_web_classifier",
      });
    },
  );

  it("accepts only bounded categorical metadata and correlation IDs", () => {
    const valid = composerRoutingDiagnostic({
      selectedMode: "auto",
      route: { route: "standard", reason: "default_standard" },
      clientBuildId: BUILD_ID,
      requestId: REQUEST_ID,
    });
    expect(Object.keys(valid).sort()).toEqual([
      "client_build_id", "entry_point", "request_id", "resolved_mode", "route_reason", "selected_mode",
    ]);
    expect(parseRoutingDiagnostic(JSON.stringify(valid))).toEqual(valid);
    expect(parseRoutingDiagnostic(JSON.stringify({ ...valid, prompt: NURSING_PROMPT }))).toBeNull();
    expect(parseRoutingDiagnostic(JSON.stringify({ ...valid, route_reason: NURSING_PROMPT }))).toBeNull();
    expect(parseRoutingDiagnostic(JSON.stringify({ ...valid, client_build_id: NURSING_PROMPT }))).toBeNull();
    expect(parseRoutingDiagnostic(JSON.stringify({ ...valid, resolved_mode: "image" }))).toBeNull();
    expect(parseRoutingDiagnostic("x".repeat(513))).toBeNull();
  });

  it("extracts the deployed build ID without retaining the Flight payload", () => {
    setNavigationBuildId("");
    vi.stubGlobal("window", { __next_f: [[1, `0:{"b":"${BUILD_ID}"}`]] });
    expect(getClientBuildId()).toBe(BUILD_ID);
    vi.unstubAllGlobals();
  });

  it("reads the hydrated Next build ID after Flight bootstrap is cleared", () => {
    vi.stubGlobal("window", { __next_f: [] });
    vi.stubGlobal("document", { scripts: [] });
    setNavigationBuildId(BUILD_ID);
    try {
      expect(getClientBuildId()).toBe(BUILD_ID);
    } finally {
      setNavigationBuildId("");
      vi.unstubAllGlobals();
    }
  });

  it("uses the chat asset identifier if the Next build ID is unavailable", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      scripts: [{ src: "https://example.test/_next/static/chunks/app/chat/page-448a82a3b8c47f9d.js" }],
    });
    expect(getClientBuildId()).toBe("448a82a3b8c47f9d");
    vi.unstubAllGlobals();
  });
});
