import { createHash } from "node:crypto";

import { QUALITY_DATA_MAX_SOURCE_BYTES } from "../../quality-data/quality-data-contract";

export const QUALITY_DATA_SOURCE_BUCKET = "quality-data-sources";
const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface StoreQualityDataSourceResult {
  readonly status: "stored" | "already_matches" | "conflict";
  readonly storage_reference: string;
}

export interface QualityDataSourceStorage {
  storeOriginal(input: {
    readonly organization_id: string;
    readonly source_key: string;
    readonly original_source_version: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
    readonly media_type: string;
  }): Promise<StoreQualityDataSourceResult>;
}

interface StorageErrorLike {
  readonly statusCode?: string | number;
}

interface QualityDataStorageClient {
  readonly storage: {
    from(bucket: string): {
      upload(path: string, body: Buffer, options: {
        readonly contentType: string;
        readonly upsert: false;
        readonly cacheControl: string;
      }): Promise<{ readonly error: StorageErrorLike | null }>;
      download(path: string): Promise<{ readonly data: Blob | null; readonly error: StorageErrorLike | null }>;
    };
  };
}

/** Service-role adapter. The bucket is private and is never exposed to client-side callers. */
export class SupabaseQualityDataSourceStorage implements QualityDataSourceStorage {
  constructor(private readonly client: QualityDataStorageClient) {}

  async storeOriginal(input: {
    readonly organization_id: string;
    readonly source_key: string;
    readonly original_source_version: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
    readonly media_type: string;
  }): Promise<StoreQualityDataSourceResult> {
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > QUALITY_DATA_MAX_SOURCE_BYTES
      || !/^[0-9a-f]{64}$/.test(input.sha256)
      || createHash("sha256").update(input.bytes).digest("hex") !== input.sha256
      || input.media_type !== XLSX_MEDIA_TYPE
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.organization_id)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.source_key)
      || input.original_source_version.trim().length === 0 || input.original_source_version.length > 128) {
      throw new Error("The quality-data source storage request is invalid.");
    }

    const sourceToken = createHash("sha256").update(input.source_key).digest("hex");
    const versionToken = createHash("sha256").update(input.original_source_version).digest("hex");
    const path = `quality-data/${input.organization_id.toLowerCase()}/${sourceToken}/${versionToken}/original`;

    const bucket = this.client.storage.from(QUALITY_DATA_SOURCE_BUCKET);
    const uploaded = await bucket.upload(path, Buffer.from(input.bytes), {
      contentType: input.media_type,
      upsert: false,
      cacheControl: "0",
    });
    if (!uploaded.error) return { status: "stored", storage_reference: path };
    if (String(uploaded.error.statusCode) !== "409") {
      throw new Error("The quality-data source could not be stored.");
    }

    const existing = await bucket.download(path);
    if (existing.error || !existing.data || existing.data.size > QUALITY_DATA_MAX_SOURCE_BYTES) {
      throw new Error("The existing quality-data source could not be verified.");
    }
    if (existing.data.size !== input.bytes.byteLength) return { status: "conflict", storage_reference: path };
    const existingHash = createHash("sha256").update(Buffer.from(await existing.data.arrayBuffer())).digest("hex");
    return {
      status: existingHash === input.sha256 ? "already_matches" : "conflict",
      storage_reference: path,
    };
  }
}
