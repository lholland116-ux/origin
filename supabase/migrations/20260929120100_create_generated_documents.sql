-- Durable metadata for generated document artifacts stored in the private
-- documents bucket. Artifact bytes are intentionally not stored in Postgres.

CREATE TABLE public.generated_documents (
  id                    uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id               uuid NOT NULL,
  conversation_id       uuid NOT NULL,
  message_id            uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  storage_path          text NOT NULL,
  filename              text NOT NULL,
  format                text NOT NULL,
  mime_type             text NOT NULL,
  size_bytes            bigint NOT NULL,
  template_id           text,
  created_at            timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT generated_documents_pkey PRIMARY KEY (id),
  CONSTRAINT generated_documents_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT generated_documents_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE,
  CONSTRAINT generated_documents_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE,
  CONSTRAINT generated_documents_format_check
    CHECK (format IN ('txt', 'md', 'docx', 'pdf', 'xlsx', 'pptx', 'zip')),
  CONSTRAINT generated_documents_mime_type_check
    CHECK (
      (format = 'txt' AND mime_type = 'text/plain') OR
      (format = 'md' AND mime_type = 'text/markdown') OR
      (
        format = 'docx' AND
        mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) OR
      (format = 'pdf' AND mime_type = 'application/pdf') OR
      (
        format = 'xlsx' AND
        mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ) OR
      (
        format = 'pptx' AND
        mime_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ) OR
      (format = 'zip' AND mime_type = 'application/zip')
    ),
  CONSTRAINT generated_documents_size_bytes_check
    CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT generated_documents_filename_check
    CHECK (
      filename = btrim(filename)
      AND filename <> ''
      AND length(filename) <= 160
      AND filename NOT LIKE '%/%'
      AND filename NOT LIKE '%\\%'
      AND filename NOT LIKE '%..%'
      AND filename NOT LIKE '%@%'
      AND filename !~ '[[:cntrl:]]'
    ),
  CONSTRAINT generated_documents_storage_path_check
    CHECK (
      storage_path = btrim(storage_path)
      AND length(storage_path) <= 500
      AND storage_path NOT LIKE '/%'
      AND storage_path NOT LIKE '%..%'
      AND storage_path NOT LIKE '%\\%'
      AND storage_path !~ '[[:cntrl:]]'
      AND storage_path !~ '/{2,}'
      AND storage_path !~ '/$'
      AND storage_path LIKE
        user_id::text || '/' || conversation_id::text || '/generated/' || id::text || '/%'
      AND right(storage_path, length(filename)) = filename
      AND (
        (format = 'txt' AND filename LIKE '%.txt') OR
        (format = 'md' AND filename LIKE '%.md') OR
        (format = 'docx' AND filename LIKE '%.docx') OR
        (format = 'pdf' AND filename LIKE '%.pdf') OR
        (format = 'xlsx' AND filename LIKE '%.xlsx') OR
        (format = 'pptx' AND filename LIKE '%.pptx') OR
        (format = 'zip' AND filename LIKE '%.zip')
      )
    ),
  CONSTRAINT generated_documents_generation_request_key
    UNIQUE (user_id, conversation_id, generation_request_id),
  CONSTRAINT generated_documents_storage_path_key
    UNIQUE (storage_path)
);

CREATE INDEX generated_documents_conversation_created_idx
  ON public.generated_documents (conversation_id, created_at DESC);

CREATE INDEX generated_documents_message_idx
  ON public.generated_documents (message_id);

ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.generated_documents FROM anon;
REVOKE ALL ON public.generated_documents FROM authenticated;
GRANT ALL ON public.generated_documents TO service_role;

COMMENT ON TABLE public.generated_documents IS
  'Immutable metadata for generated documents stored in the private documents bucket.';
