export type GeneratedImageHistory = {
  id: string;
  url: string;
  mimeType: string;
  provider: string;
  model: string;
};

const SAFE_MIME_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeMetadata(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    /^[a-zA-Z0-9._:/@-]+$/.test(value)
  );
}

export function normalizeGeneratedImageMimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return SAFE_MIME_TYPES.has(mimeType) ? mimeType : null;
}

export function isValidGeneratedImagePath(
  storagePath: string,
  userId: string,
  conversationId: string,
): boolean {
  const prefix = `generated/${userId}/${conversationId}/`;

  return (
    storagePath.length > prefix.length &&
    storagePath.length <= 500 &&
    storagePath.startsWith(prefix) &&
    !storagePath.includes("..") &&
    !storagePath.includes("\\") &&
    !storagePath.startsWith("/") &&
    !/[^a-zA-Z0-9._:/-]/.test(storagePath) &&
    !/\/[./]/.test(storagePath)
  );
}

type NormalizedGeneratedImageRow = {
  id: string;
  message_id: string;
  storage_path: string;
  mime_type: string;
  provider: string;
  model: string;
};

function normalizeGeneratedImageRow(
  input: unknown,
  userId: string,
  conversationId: string,
): NormalizedGeneratedImageRow | null {
  if (!isRecord(input)) return null;

  const id = typeof input.id === "string" ? input.id.trim() : "";
  const messageId =
    typeof input.message_id === "string" ? input.message_id.trim() : "";
  const storagePath =
    typeof input.storage_path === "string" ? input.storage_path.trim() : "";
  const mimeType = normalizeGeneratedImageMimeType(input.mime_type);
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";

  if (
    !id ||
    !messageId ||
    !mimeType ||
    !isValidGeneratedImagePath(storagePath, userId, conversationId) ||
    !isSafeMetadata(provider) ||
    !isSafeMetadata(model)
  ) {
    return null;
  }

  return {
    id,
    message_id: messageId,
    storage_path: storagePath,
    mime_type: mimeType,
    provider,
    model,
  };
}

export async function hydrateGeneratedImageRows(params: {
  rows: unknown[];
  userId: string;
  conversationId: string;
  sign: (storagePath: string) => Promise<string | null>;
}): Promise<Map<string, GeneratedImageHistory>> {
  const hydrated = new Map<string, GeneratedImageHistory>();

  await Promise.all(
    params.rows.map(async (rawRow) => {
      const row = normalizeGeneratedImageRow(
        rawRow,
        params.userId,
        params.conversationId,
      );
      if (!row) return;

      const url = await params.sign(row.storage_path);
      if (!url || !/^https:\/\//i.test(url)) return;

      hydrated.set(row.message_id, {
        id: row.id,
        url,
        mimeType: row.mime_type,
        provider: row.provider,
        model: row.model,
      });
    }),
  );

  return hydrated;
}
