import type { OrganizationId } from "../capa/domain/capa-types";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class CapaDevelopmentOrganizationConfigurationError extends Error {
  constructor(value: string) {
    super(
      `CAPA_DEVELOPMENT_ORGANIZATION_ID must be an absent or canonical UUID: ${value}.`,
    );
    this.name =
      "CapaDevelopmentOrganizationConfigurationError";
  }
}

export function resolveCapaDevelopmentOrganizationId(
  value: string | undefined,
): OrganizationId | null {
  if (value === undefined) return null;

  if (!CANONICAL_UUID_PATTERN.test(value)) {
    throw new CapaDevelopmentOrganizationConfigurationError(
      value,
    );
  }

  return value as OrganizationId;
}
