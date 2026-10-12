import { z } from "zod";

const isoDateTimeWithOffsetSchema = z.string().datetime({ offset: true });
const ISO_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Convert a validated database timestamptz to the UTC form required by durable references. */
export function canonicalizeGeneratedDocumentCreatedAt(value: string): string | null {
  const parsed = isoDateTimeWithOffsetSchema.safeParse(value);
  if (!parsed.success) return null;
  const match = ISO_DATE_TIME_PATTERN.exec(parsed.data);
  if (!match) return null;
  const instant = new Date(`${match[1]}${match[3]}`);
  if (!Number.isFinite(instant.getTime())) return null;
  const canonical = instant.toISOString();
  return match[2]
    ? `${canonical.slice(0, -5)}${match[2]}Z`
    : canonical;
}
