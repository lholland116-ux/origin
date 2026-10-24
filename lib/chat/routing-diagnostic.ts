import type { IntelligenceRouteDecision } from "@/lib/ai/intelligence-router";
import { getNavigationBuildId } from "next/dist/client/navigation-build-id";

export const ROUTING_DIAGNOSTIC_HEADER = "X-LVTChat-Routing-Diagnostic";

const ROUTE_REASONS = new Set<IntelligenceRouteDecision["reason"] | "regenerate_image">([
  "explicit_standard",
  "explicit_web_search",
  "explicit_create_image",
  "image_edit_intent",
  "image_generation_intent",
  "document_generation_intent",
  "file_analysis_intent",
  "attachment_safe_fallback",
  "image_edit_not_executable",
  "auto_web_search_required",
  "existing_auto_web_classifier",
  "default_standard",
  "regenerate_image",
]);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILD_ID_PATTERN = /^(?:[A-Za-z0-9_-]{21}|[a-f0-9]{16}|unavailable)$/;
const FLIGHT_BUILD_ID_PATTERN = /"b":"([A-Za-z0-9_-]{21})"/;
const CHAT_PAGE_CHUNK_PATTERN = /\/app\/chat\/page-([a-f0-9]{16})\.js(?:$|[?#])/;

export type RoutingDiagnostic = Readonly<{
  entry_point: "composer_submit" | "regenerate_image";
  selected_mode: "auto" | "create_image";
  resolved_mode: "text" | "image";
  route_reason: IntelligenceRouteDecision["reason"] | "regenerate_image";
  client_build_id: string;
  request_id: string;
}>;

export function composerRoutingDiagnostic(input: {
  selectedMode: RoutingDiagnostic["selected_mode"];
  route: IntelligenceRouteDecision;
  clientBuildId: string;
  requestId: string;
}): RoutingDiagnostic {
  return {
    entry_point: "composer_submit",
    selected_mode: input.selectedMode,
    resolved_mode: input.route.route === "image_generation" ? "image" : "text",
    route_reason: input.route.reason,
    client_build_id: input.clientBuildId,
    request_id: input.requestId,
  };
}

export function regenerateImageRoutingDiagnostic(input: {
  selectedMode: RoutingDiagnostic["selected_mode"];
  clientBuildId: string;
  requestId: string;
}): RoutingDiagnostic {
  return {
    entry_point: "regenerate_image",
    selected_mode: input.selectedMode,
    resolved_mode: "image",
    route_reason: "regenerate_image",
    client_build_id: input.clientBuildId,
    request_id: input.requestId,
  };
}

export function getClientBuildId(): string {
  if (typeof window === "undefined") return "unavailable";

  try {
    // Next retains this client bundle's ID after it consumes and clears __next_f.
    const navigationBuildId = getNavigationBuildId();
    if (BUILD_ID_PATTERN.test(navigationBuildId) && navigationBuildId !== "unavailable") {
      return navigationBuildId;
    }

    // Next embeds its build ID in the initial Flight bootstrap. Read only the bounded
    // build-ID token; never retain or log the surrounding page payload.
    const flight = (window as Window & { __next_f?: unknown }).__next_f;
    if (Array.isArray(flight)) {
      for (const entry of flight.slice(0, 16)) {
        if (!Array.isArray(entry) || entry[0] !== 1 || typeof entry[1] !== "string") continue;
        const match = FLIGHT_BUILD_ID_PATTERN.exec(entry[1].slice(0, 65_536));
        if (match?.[1]) return match[1];
      }
    }

    // Retain a useful client asset identity if Next changes its bootstrap shape.
    for (const script of Array.from(document.scripts)) {
      const match = CHAT_PAGE_CHUNK_PATTERN.exec(script.src);
      if (match?.[1]) return match[1];
    }
  } catch {
    // Optional diagnostics must never prevent the user's request.
  }
  return "unavailable";
}

export function routingDiagnosticHeader(diagnostic: RoutingDiagnostic): Record<string, string> {
  return { [ROUTING_DIAGNOSTIC_HEADER]: JSON.stringify(diagnostic) };
}

export function parseRoutingDiagnostic(value: string | null): RoutingDiagnostic | null {
  if (!value || value.length > 512) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).length !== 6 ||
    !Object.keys(record).every((key) =>
      ["entry_point", "selected_mode", "resolved_mode", "route_reason", "client_build_id", "request_id"].includes(key)
    ) ||
    (record.entry_point !== "composer_submit" && record.entry_point !== "regenerate_image") ||
    (record.selected_mode !== "auto" && record.selected_mode !== "create_image") ||
    (record.resolved_mode !== "text" && record.resolved_mode !== "image") ||
    typeof record.route_reason !== "string" ||
    !ROUTE_REASONS.has(record.route_reason as RoutingDiagnostic["route_reason"]) ||
    typeof record.client_build_id !== "string" ||
    !BUILD_ID_PATTERN.test(record.client_build_id) ||
    typeof record.request_id !== "string" ||
    !REQUEST_ID_PATTERN.test(record.request_id)
  ) return null;

  if (
    (record.entry_point === "regenerate_image" &&
      (record.resolved_mode !== "image" || record.route_reason !== "regenerate_image")) ||
    (record.entry_point === "composer_submit" && record.route_reason === "regenerate_image") ||
    (record.entry_point === "composer_submit" && record.resolved_mode === "image" &&
      record.route_reason !== "explicit_create_image" &&
      record.route_reason !== "image_generation_intent") ||
    (record.resolved_mode === "text" &&
      (record.route_reason === "explicit_create_image" ||
        record.route_reason === "image_generation_intent"))
  ) return null;

  return {
    entry_point: record.entry_point,
    selected_mode: record.selected_mode,
    resolved_mode: record.resolved_mode,
    route_reason: record.route_reason as RoutingDiagnostic["route_reason"],
    client_build_id: record.client_build_id,
    request_id: record.request_id,
  };
}
