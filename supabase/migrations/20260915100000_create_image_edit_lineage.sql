-- Durable, immutable lineage for generated-image edit derivatives.

BEGIN;

CREATE TABLE public.image_edit_lineage (
  id                            uuid                     DEFAULT gen_random_uuid() NOT NULL,
  derivative_generated_image_id uuid                     NOT NULL,
  operation                     text                     NOT NULL,
  source_generated_image_id     uuid,
  source_uploaded_message_id    uuid,
  source_uploaded_ordinal       integer,
  instruction                   text                     NOT NULL,
  created_at                    timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.image_edit_lineage
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.image_edit_lineage
  ADD CONSTRAINT image_edit_lineage_pkey PRIMARY KEY (id);

ALTER TABLE public.image_edit_lineage
  ADD CONSTRAINT image_edit_lineage_derivative_fkey
    FOREIGN KEY (derivative_generated_image_id)
    REFERENCES public.message_generated_images(id)
    ON DELETE CASCADE;

ALTER TABLE public.image_edit_lineage
  ADD CONSTRAINT image_edit_lineage_source_generated_fkey
    FOREIGN KEY (source_generated_image_id)
    REFERENCES public.message_generated_images(id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.image_edit_lineage
  ADD CONSTRAINT image_edit_lineage_source_uploaded_fkey
    FOREIGN KEY (source_uploaded_message_id, source_uploaded_ordinal)
    REFERENCES public.message_images(message_id, ordinal)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.image_edit_lineage
  ADD CONSTRAINT image_edit_lineage_operation_check
    CHECK (operation = 'edit');

ALTER TABLE public.image_edit_lineage
  ADD CONSTRAINT image_edit_lineage_source_check
    CHECK (
      (
        source_generated_image_id IS NOT NULL
        AND source_uploaded_message_id IS NULL
        AND source_uploaded_ordinal IS NULL
        AND source_generated_image_id <> derivative_generated_image_id
      )
      OR (
        source_generated_image_id IS NULL
        AND source_uploaded_message_id IS NOT NULL
        AND source_uploaded_ordinal IS NOT NULL
        AND source_uploaded_ordinal > 0
      )
    );

ALTER TABLE public.image_edit_lineage
  ADD CONSTRAINT image_edit_lineage_instruction_check
    CHECK (btrim(instruction) <> '' AND char_length(instruction) <= 4000);

ALTER TABLE public.image_edit_lineage
  ADD CONSTRAINT image_edit_lineage_derivative_key
    UNIQUE (derivative_generated_image_id);

CREATE INDEX image_edit_lineage_source_generated_idx
  ON public.image_edit_lineage (source_generated_image_id)
  WHERE source_generated_image_id IS NOT NULL;

CREATE INDEX image_edit_lineage_source_uploaded_idx
  ON public.image_edit_lineage (source_uploaded_message_id, source_uploaded_ordinal)
  WHERE source_uploaded_message_id IS NOT NULL;

REVOKE ALL ON public.image_edit_lineage FROM PUBLIC;
REVOKE ALL ON public.image_edit_lineage FROM anon;
REVOKE ALL ON public.image_edit_lineage FROM authenticated;
GRANT SELECT ON public.image_edit_lineage TO authenticated;
GRANT ALL ON public.image_edit_lineage TO service_role;

CREATE POLICY "Users can view own image edit lineage"
  ON public.image_edit_lineage
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.message_generated_images AS derivative
      WHERE derivative.id = image_edit_lineage.derivative_generated_image_id
        AND derivative.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.image_edit_lineage IS
  'Immutable source lineage and exact human instructions for generated-image edits.';

-- Atomically persist an image-edit chat turn, derivative metadata, lineage, and
-- successful image-generation attempt. Provider execution remains outside SQL.
CREATE OR REPLACE FUNCTION public.complete_generated_image_edit(
  p_attempt_id                 uuid,
  p_conversation_id            uuid,
  p_instruction                text,
  p_storage_path               text,
  p_mime_type                  text,
  p_provider                   text,
  p_model                      text,
  p_source_generated_image_id  uuid,
  p_source_uploaded_message_id uuid,
  p_source_uploaded_ordinal    integer
)
RETURNS TABLE (
  user_message_id      uuid,
  assistant_message_id uuid,
  generated_image_id   uuid,
  lineage_id           uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id                    uuid;
  v_status                     text;
  v_attempt_conversation_id   uuid;
  v_expires_at                timestamp with time zone;
  v_provider_started_at       timestamp with time zone;
  v_user_message_id           uuid;
  v_assistant_message_id      uuid;
  v_generated_image_id        uuid;
  v_lineage_id                uuid;
  v_prefix                    text;
  v_provider                  text := btrim(p_provider);
  v_model                     text := btrim(p_model);
  v_now                       timestamp with time zone := clock_timestamp();
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT
    status,
    conversation_id,
    expires_at,
    provider_started_at
  INTO
    v_status,
    v_attempt_conversation_id,
    v_expires_at,
    v_provider_started_at
  FROM public.image_generation_attempts
  WHERE id = p_attempt_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_NOT_FOUND';
  END IF;

  IF v_attempt_conversation_id IS DISTINCT FROM p_conversation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_CONVERSATION_MISMATCH';
  END IF;

  IF v_status <> 'reserved' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_NOT_RESERVED';
  END IF;

  IF v_expires_at <= v_now THEN
    UPDATE public.image_generation_attempts
    SET
      status = 'released',
      released_at = v_now,
      release_reason = 'expired'
    WHERE id = p_attempt_id
      AND user_id = v_user_id
      AND status = 'reserved';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_RESERVATION_EXPIRED';
  END IF;

  IF v_provider_started_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_PROVIDER_NOT_STARTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations
    WHERE id = p_conversation_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  v_prefix := 'generated/' || v_user_id::text || '/' || p_conversation_id::text || '/';

  IF p_instruction IS NULL
     OR btrim(p_instruction) = ''
     OR char_length(p_instruction) > 4000
     OR p_storage_path IS NULL
     OR left(p_storage_path, length(v_prefix)) <> v_prefix
     OR length(p_storage_path) > 500
     OR position('..' in p_storage_path) > 0
     OR position(chr(92) in p_storage_path) > 0
     OR p_storage_path ~ '[[:cntrl:]]'
     OR p_mime_type IS NULL
     OR p_mime_type NOT IN ('image/webp', 'image/png', 'image/jpeg')
     OR v_provider IS NULL OR v_provider = '' OR length(v_provider) > 100
     OR v_provider !~ '^[a-zA-Z0-9._:/-]+$'
     OR v_model IS NULL OR v_model = '' OR length(v_model) > 100
     OR v_model !~ '^[a-zA-Z0-9._:/-]+$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_IMAGE_EDIT';
  END IF;

  IF (
       p_source_generated_image_id IS NOT NULL
       AND (p_source_uploaded_message_id IS NOT NULL OR p_source_uploaded_ordinal IS NOT NULL)
     )
     OR (
       p_source_generated_image_id IS NULL
       AND (p_source_uploaded_message_id IS NULL OR p_source_uploaded_ordinal IS NULL)
     )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGE_EDIT_SOURCE';
  END IF;

  IF p_source_generated_image_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.message_generated_images AS source_image
      JOIN public.messages AS source_message
        ON source_message.id = source_image.message_id
      WHERE source_image.id = p_source_generated_image_id
        AND source_image.user_id = v_user_id
        AND source_image.conversation_id = p_conversation_id
        AND source_message.user_id = v_user_id
        AND source_message.conversation_id = p_conversation_id
        AND source_message.role = 'assistant'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_SOURCE_NOT_FOUND';
    END IF;
  ELSE
    IF p_source_uploaded_ordinal < 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGE_EDIT_SOURCE';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.message_images AS source_image
      JOIN public.messages AS source_message
        ON source_message.id = source_image.message_id
      WHERE source_image.message_id = p_source_uploaded_message_id
        AND source_image.ordinal = p_source_uploaded_ordinal
        AND source_message.user_id = v_user_id
        AND source_message.conversation_id = p_conversation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_SOURCE_NOT_FOUND';
    END IF;
  END IF;

  INSERT INTO public.messages (
    conversation_id,
    user_id,
    role,
    content,
    documents
  )
  VALUES (
    p_conversation_id,
    v_user_id,
    'user',
    p_instruction,
    '[]'::jsonb
  )
  RETURNING id INTO v_user_message_id;

  INSERT INTO public.messages (
    conversation_id,
    user_id,
    role,
    content,
    documents
  )
  VALUES (
    p_conversation_id,
    v_user_id,
    'assistant',
    '',
    '[]'::jsonb
  )
  RETURNING id INTO v_assistant_message_id;

  INSERT INTO public.message_generated_images (
    message_id,
    conversation_id,
    user_id,
    storage_path,
    mime_type,
    provider,
    model
  )
  VALUES (
    v_assistant_message_id,
    p_conversation_id,
    v_user_id,
    p_storage_path,
    p_mime_type,
    v_provider,
    v_model
  )
  RETURNING id INTO v_generated_image_id;

  INSERT INTO public.image_edit_lineage (
    derivative_generated_image_id,
    operation,
    source_generated_image_id,
    source_uploaded_message_id,
    source_uploaded_ordinal,
    instruction
  )
  VALUES (
    v_generated_image_id,
    'edit',
    p_source_generated_image_id,
    p_source_uploaded_message_id,
    p_source_uploaded_ordinal,
    p_instruction
  )
  RETURNING id INTO v_lineage_id;

  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = p_conversation_id
    AND user_id = v_user_id;

  UPDATE public.image_generation_attempts
  SET
    status = 'succeeded',
    completed_at = v_now
  WHERE id = p_attempt_id
    AND user_id = v_user_id
    AND status = 'reserved';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_ATTEMPT_FINALIZATION_FAILED';
  END IF;

  RETURN QUERY
  SELECT v_user_message_id, v_assistant_message_id, v_generated_image_id, v_lineage_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_generated_image_edit(
  uuid, uuid, text, text, text, text, text, uuid, uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_generated_image_edit(
  uuid, uuid, text, text, text, text, text, uuid, uuid, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_generated_image_edit(
  uuid, uuid, text, text, text, text, text, uuid, uuid, integer
) TO authenticated;

COMMIT;
