-- Atomically persist a chat-generated document confirmation and its durable metadata.
-- Storage bytes are uploaded before this function and removed by the caller on failure.

CREATE OR REPLACE FUNCTION public.persist_generated_document_chat(
  p_conversation_id       uuid,
  p_generation_request_id uuid,
  p_generated_document_id uuid,
  p_storage_path          text,
  p_filename              text,
  p_format                text,
  p_mime_type             text,
  p_size_bytes            bigint,
  p_template_id           text,
  p_content               text
)
RETURNS TABLE (
  assistant_message_id uuid,
  generated_document_id uuid,
  was_existing         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_existing public.generated_documents%ROWTYPE;
  v_message_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF p_generation_request_id IS NULL OR p_generated_document_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_DOCUMENT';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_user_id::text || ':' || p_conversation_id::text || ':' || p_generation_request_id::text,
      0
    )
  );

  SELECT gd.*
  INTO v_existing
  FROM public.generated_documents AS gd
  WHERE gd.user_id = v_user_id
    AND gd.conversation_id = p_conversation_id
    AND gd.generation_request_id = p_generation_request_id;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.message_id, v_existing.id, true;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations
    WHERE id = p_conversation_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
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
    'assistant',
    p_content,
    '[]'::jsonb
  )
  RETURNING id INTO v_message_id;

  INSERT INTO public.generated_documents (
    id,
    user_id,
    conversation_id,
    message_id,
    generation_request_id,
    storage_path,
    filename,
    format,
    mime_type,
    size_bytes,
    template_id
  )
  VALUES (
    p_generated_document_id,
    v_user_id,
    p_conversation_id,
    v_message_id,
    p_generation_request_id,
    p_storage_path,
    p_filename,
    p_format,
    p_mime_type,
    p_size_bytes,
    p_template_id
  );

  RETURN QUERY SELECT v_message_id, p_generated_document_id, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_generated_document_chat(
  uuid, uuid, uuid, text, text, text, text, bigint, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_generated_document_chat(
  uuid, uuid, uuid, text, text, text, text, bigint, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.persist_generated_document_chat(
  uuid, uuid, uuid, text, text, text, text, bigint, text, text
) TO authenticated;

COMMENT ON FUNCTION public.persist_generated_document_chat(
  uuid, uuid, uuid, text, text, text, text, bigint, text, text
) IS 'Atomically persists an authenticated chat document confirmation and its owner-scoped metadata.';
