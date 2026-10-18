const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type QualityDataAiGate = { readonly status: "disabled" | "misconfigured" }
  | { readonly status: "enabled"; readonly organization_ids: ReadonlySet<string> };

export function parseQualityDataAiGate(enabledValue: string | undefined, organizationIdsValue: string | undefined): QualityDataAiGate {
  if (enabledValue === undefined || enabledValue === "false") return { status: "disabled" };
  if (enabledValue !== "true" || !organizationIdsValue || organizationIdsValue.length > 4096) return { status: "misconfigured" };
  const organizations = organizationIdsValue.split(",").map((value) => value.trim());
  if (organizations.length < 1 || organizations.length > 100 || organizations.some((value) => !UUID.test(value))) return { status: "misconfigured" };
  return { status: "enabled", organization_ids: new Set(organizations.map((value) => value.toLowerCase())) };
}

export function isQualityDataAiOrganizationAllowed(gate: QualityDataAiGate | undefined, organizationId: string): boolean {
  return gate?.status === "enabled" && UUID.test(organizationId) && gate.organization_ids.has(organizationId.toLowerCase());
}
