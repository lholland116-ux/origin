const ORGANIZATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PILOT_ORGANIZATION_IDS = 100;
const MAX_PILOT_ORGANIZATION_IDS_CONFIG_BYTES = 4_096;

export type QualityDataPilotGate =
  | { readonly status: "disabled" | "misconfigured" }
  | { readonly status: "enabled"; readonly organization_ids: ReadonlySet<string> };

export function parseQualityDataPilotGate(
  enabledValue: string | undefined,
  organizationIdsValue: string | undefined,
): QualityDataPilotGate {
  if (enabledValue === undefined || enabledValue === "false") return { status: "disabled" };
  if (enabledValue !== "true") return { status: "misconfigured" };
  if (organizationIdsValue === undefined || organizationIdsValue.length === 0
    || Buffer.byteLength(organizationIdsValue, "utf8") > MAX_PILOT_ORGANIZATION_IDS_CONFIG_BYTES) {
    return { status: "misconfigured" };
  }

  const entries = organizationIdsValue.split(",").map((entry) => entry.trim());
  if (entries.length === 0 || entries.length > MAX_PILOT_ORGANIZATION_IDS
    || entries.some((entry) => !ORGANIZATION_ID_PATTERN.test(entry))) {
    return { status: "misconfigured" };
  }

  return { status: "enabled", organization_ids: new Set(entries.map((entry) => entry.toLowerCase())) };
}

export function isQualityDataPilotOrganizationAllowed(
  gate: QualityDataPilotGate | undefined,
  serverResolvedOrganizationId: string,
): boolean {
  return gate?.status === "enabled"
    && ORGANIZATION_ID_PATTERN.test(serverResolvedOrganizationId)
    && gate.organization_ids.has(serverResolvedOrganizationId.toLowerCase());
}
