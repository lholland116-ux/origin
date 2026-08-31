export interface CapaParticipant {
  readonly userId: string;
  readonly displayLabel: string | null;
}

export interface CapaParticipantDirectory {
  readonly participants: readonly CapaParticipant[];
  readonly correlationId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

export function parseCapaParticipantDirectory(value: unknown): CapaParticipantDirectory | null {
  if (!record(value) || !exact(value, ["purpose", "participants", "correlation_id"]) ||
    value.purpose !== "investigation_owner" || !Array.isArray(value.participants) ||
    typeof value.correlation_id !== "string" || !UUID.test(value.correlation_id)) return null;
  const seen = new Set<string>();
  const participants: CapaParticipant[] = [];
  for (const source of value.participants) {
    if (!record(source) || !exact(source, ["user_id", "display_label"]) ||
      typeof source.user_id !== "string" || !UUID.test(source.user_id) ||
      (source.display_label !== null && (typeof source.display_label !== "string" ||
        source.display_label.trim() !== source.display_label || source.display_label.length === 0))) return null;
    const normalizedUserId = source.user_id.toLowerCase();
    if (seen.has(normalizedUserId)) return null;
    seen.add(normalizedUserId);
    participants.push(Object.freeze({ userId: source.user_id, displayLabel: source.display_label }));
  }
  return Object.freeze({ participants: Object.freeze(participants), correlationId: value.correlation_id });
}

export async function fetchCapaInvestigationOwners(fetcher: typeof fetch = fetch): Promise<CapaParticipantDirectory> {
  const response = await fetcher("/api/capa/participants?purpose=investigation_owner", {
    method: "GET", cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Assignable investigation owners could not be loaded.");
  const parsed = parseCapaParticipantDirectory(body);
  if (parsed === null) throw new Error("The participant directory response could not be verified.");
  return parsed;
}
