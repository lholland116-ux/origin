import type { TransactionContext } from "../transactions";
import type { QualityDataIngestionCommand, QualityDataIngestionReceipt, QualityDataScope, QualityDataValidationOutcome } from "../../quality-data/quality-data-contract";

export interface QualityDataPersistInput {
  readonly organization_id: string;
  readonly membership_id: string;
  readonly uploader_user_id: string;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly command: QualityDataIngestionCommand;
  readonly validation_outcomes: readonly QualityDataValidationOutcome[];
  readonly now: string;
  readonly create_uuid: () => string;
}

export type QualityDataPersistResult =
  | { readonly status: "inserted"; readonly receipt: QualityDataIngestionReceipt }
  | { readonly status: "already_registered"; readonly receipt: QualityDataIngestionReceipt }
  | { readonly status: "unauthorized" }
  | { readonly status: "conflict"; readonly reason_code: "IDEMPOTENCY_KEY_REUSED" | "SOURCE_IDENTITY_CONFLICT" | "DATASET_IDENTITY_CONFLICT" | "SOURCE_VERSION_CONFLICT" };

export interface QualityDataDatasetSnapshot {
  readonly dataset: {
    readonly dataset_id: string;
    readonly dataset_key: string;
    readonly dataset_name: string;
    readonly organization_id: string;
  };
  readonly version: {
    readonly dataset_version_id: string;
    readonly version_number: number;
    readonly schema_version: string;
    readonly review_state: "review_required";
    readonly created_at: string;
  };
  readonly source_versions: readonly Readonly<Record<string, unknown>>[];
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly validation_outcomes: readonly Readonly<Record<string, unknown>>[];
}

export interface QualityDataReadScope extends QualityDataScope {
  readonly user_id: string;
  readonly membership_id: string;
  readonly now: string;
}

export interface QualityDataRepository {
  persistIngestion(
    transaction: TransactionContext,
    input: QualityDataPersistInput,
  ): Promise<QualityDataPersistResult>;

  findDatasetVersion(
    scope: QualityDataReadScope,
    datasetVersionId: string,
  ): Promise<QualityDataDatasetSnapshot | null>;
}

export class QualityDataRepositoryError extends Error {
  constructor(message = "The quality-data persistence operation failed.") {
    super(message);
    this.name = "QualityDataRepositoryError";
  }
}
