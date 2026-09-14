-- Durable metadata for provider-generated images stored in the private chat-images bucket.

CREATE TABLE public.message_generated_images (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  message_id      uuid                     NOT NULL,
  conversation_id uuid                     NOT NULL,
  user_id         uuid                     NOT NULL,
  storage_path    text                     NOT NULL,
  mime_type       text                     NOT NULL,
  provider        text                     NOT NULL,
  model           text                     NOT NULL,
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.message_generated_images
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.message_generated_images
  ADD CONSTRAINT message_generated_images_pkey PRIMARY KEY (id);

ALTER TABLE public.message_generated_images
  ADD CONSTRAINT message_generated_images_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

ALTER TABLE public.message_generated_images
  ADD CONSTRAINT message_generated_images_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE public.message_generated_images
  ADD CONSTRAINT message_generated_images_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.message_generated_images
  ADD CONSTRAINT message_generated_images_mime_type_check
    CHECK (mime_type IN ('image/webp', 'image/png', 'image/jpeg'));

ALTER TABLE public.message_generated_images
  ADD CONSTRAINT message_generated_images_storage_path_check
    CHECK (
      storage_path LIKE 'generated/%'
      AND storage_path NOT LIKE '%..%'
      AND storage_path NOT LIKE '%\\%'
      AND storage_path !~ '[[:cntrl:]]'
    );

ALTER TABLE public.message_generated_images
  ADD CONSTRAINT message_generated_images_message_id_key UNIQUE (message_id);

ALTER TABLE public.message_generated_images
  ADD CONSTRAINT message_generated_images_storage_path_key UNIQUE (storage_path);

CREATE INDEX message_generated_images_conversation_user_created_idx
  ON public.message_generated_images (conversation_id, user_id, created_at);

REVOKE ALL ON public.message_generated_images FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_generated_images TO authenticated;

GRANT ALL ON public.message_generated_images TO service_role;

CREATE POLICY "Users can view own generated images"
  ON public.message_generated_images
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_generated_images.message_id
        AND public.messages.conversation_id = message_generated_images.conversation_id
        AND public.messages.user_id = message_generated_images.user_id
    )
    AND storage_path LIKE 'generated/' || auth.uid()::text || '/' || conversation_id::text || '/%'
  );

CREATE POLICY "Users can insert own generated images"
  ON public.message_generated_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_generated_images.message_id
        AND public.messages.conversation_id = message_generated_images.conversation_id
        AND public.messages.user_id = message_generated_images.user_id
    )
    AND storage_path LIKE 'generated/' || auth.uid()::text || '/' || conversation_id::text || '/%'
    AND storage_path NOT LIKE '%..%'
    AND storage_path NOT LIKE '%\\%'
    AND storage_path !~ '[[:cntrl:]]'
  );

CREATE POLICY "Users can update own generated images"
  ON public.message_generated_images
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_generated_images.message_id
        AND public.messages.conversation_id = message_generated_images.conversation_id
        AND public.messages.user_id = message_generated_images.user_id
    )
    AND storage_path LIKE 'generated/' || auth.uid()::text || '/' || conversation_id::text || '/%'
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_generated_images.message_id
        AND public.messages.conversation_id = message_generated_images.conversation_id
        AND public.messages.user_id = message_generated_images.user_id
    )
    AND storage_path LIKE 'generated/' || auth.uid()::text || '/' || conversation_id::text || '/%'
    AND storage_path NOT LIKE '%..%'
    AND storage_path NOT LIKE '%\\%'
    AND storage_path !~ '[[:cntrl:]]'
  );

CREATE POLICY "Users can delete own generated images"
  ON public.message_generated_images
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_generated_images.message_id
        AND public.messages.conversation_id = message_generated_images.conversation_id
        AND public.messages.user_id = message_generated_images.user_id
    )
  );

COMMENT ON TABLE public.message_generated_images IS
  'Durable metadata for generated images stored in the private chat-images bucket.';

-- Keep the generated exchange atomic and derive tenant identity from auth.uid().
CREATE OR REPLACE FUNCTION public.create_generated_image_chat_exchange(
  p_conversation_id uuid,
  p_content         text,
  p_storage_path    text,
  p_mime_type       text,
  p_provider        text,
  p_model           text
)
RETURNS TABLE (
  user_message_id      uuid,
  assistant_message_id uuid,
  generated_image_id   uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_generated_image_id uuid;
  v_prefix text;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
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

  IF p_content IS NULL OR btrim(p_content) = ''
     OR p_storage_path IS NULL
     OR left(p_storage_path, length(v_prefix)) <> v_prefix
     OR length(p_storage_path) > 500
     OR position('..' in p_storage_path) > 0
     OR position(chr(92) in p_storage_path) > 0
     OR p_storage_path ~ '[[:cntrl:]]'
     OR p_mime_type NOT IN ('image/webp', 'image/png', 'image/jpeg')
     OR p_provider IS NULL OR btrim(p_provider) = '' OR length(p_provider) > 100
     OR p_model IS NULL OR btrim(p_model) = '' OR length(p_model) > 100
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_IMAGE';
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
    p_content,
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
    btrim(p_provider),
    btrim(p_model)
  )
  RETURNING id INTO v_generated_image_id;

  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = p_conversation_id
    AND user_id = v_user_id;

  RETURN QUERY SELECT v_user_message_id, v_assistant_message_id, v_generated_image_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_generated_image_chat_exchange(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_generated_image_chat_exchange(uuid, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_generated_image_chat_exchange(uuid, text, text, text, text, text) TO authenticated;
