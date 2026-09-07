import type { RoleId } from "../capa/domain/capa-types";

export const CAPA_DEVELOPMENT_ROLE_IDS = [
  "CAPA_OWNER",
  "CAPA_CONTRIBUTOR",
  "CAPA_REVIEWER",
  "CAPA_APPROVER",
  "CAPA_AUDITOR",
] as const;

const DEFAULT_CAPA_DEVELOPMENT_ROLE_ID = "CAPA_OWNER";

export class CapaDevelopmentRoleConfigurationError extends Error {
  constructor(value: string) {
    super(`CAPA_DEVELOPMENT_ROLE_ID is not an allowed development role: ${value}.`);
    this.name = "CapaDevelopmentRoleConfigurationError";
  }
}

export function resolveCapaDevelopmentRoleId(
  value: string | undefined,
): RoleId {
  const configuredValue = value ?? "";
  if (configuredValue.trim().length === 0) {
    return DEFAULT_CAPA_DEVELOPMENT_ROLE_ID as RoleId;
  }
  if (
    (CAPA_DEVELOPMENT_ROLE_IDS as readonly string[]).includes(
      configuredValue,
    )
  ) {
    return configuredValue as RoleId;
  }
  throw new CapaDevelopmentRoleConfigurationError(
    configuredValue,
  );
}
