import type {
  GeneratedDocumentMetadata,
  GeneratedDocumentPersistenceRecord,
} from "./generated-document-contracts";

export type GeneratedDocumentRepository = Readonly<{
  create: (
    record: GeneratedDocumentPersistenceRecord,
  ) => Promise<GeneratedDocumentMetadata>;
  getByIdForUser: (
    generatedDocumentId: string,
    userId: string,
  ) => Promise<GeneratedDocumentMetadata | null>;
  listForConversation: (
    conversationId: string,
    userId: string,
  ) => Promise<readonly GeneratedDocumentMetadata[]>;
  deleteByIdForUser: (
    generatedDocumentId: string,
    userId: string,
  ) => Promise<boolean>;
}>;

export type GeneratedDocumentStorage = Readonly<{
  upload: (
    storagePath: string,
    bytes: Uint8Array,
    mimeType: string,
  ) => Promise<void>;
  download: (storagePath: string) => Promise<Uint8Array>;
  remove: (storagePath: string) => Promise<void>;
}>;

export type GeneratedDocumentRepositoryAdapter = Readonly<{
  insert: (
    record: GeneratedDocumentPersistenceRecord,
  ) => Promise<GeneratedDocumentMetadata>;
  findByIdForUser: (
    generatedDocumentId: string,
    userId: string,
  ) => Promise<GeneratedDocumentMetadata | null>;
  findForConversation: (
    conversationId: string,
    userId: string,
  ) => Promise<readonly GeneratedDocumentMetadata[]>;
  removeByIdForUser: (
    generatedDocumentId: string,
    userId: string,
  ) => Promise<boolean>;
}>;

/** B1 keeps the persistence boundary injectable for the later server routes. */
export function createGeneratedDocumentRepository(
  adapter: GeneratedDocumentRepositoryAdapter,
): GeneratedDocumentRepository {
  return {
    create: adapter.insert,
    getByIdForUser: adapter.findByIdForUser,
    listForConversation: adapter.findForConversation,
    deleteByIdForUser: adapter.removeByIdForUser,
  };
}
