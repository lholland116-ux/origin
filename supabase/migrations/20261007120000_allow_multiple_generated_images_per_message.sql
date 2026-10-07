BEGIN;

ALTER TABLE public.message_generated_images
  DROP CONSTRAINT message_generated_images_message_id_key;

CREATE INDEX message_generated_images_message_id_idx
  ON public.message_generated_images (message_id);

CREATE FUNCTION public.delete_generated_image_metadata(
  p_generated_image_id uuid
)
RETURNS TABLE (
  image_deleted   boolean,
  message_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_message_id uuid;
  v_locked_message_id uuid;
  v_message_deleted boolean := false;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  SELECT image.message_id
  INTO v_message_id
  FROM public.message_generated_images AS image
  WHERE image.id = p_generated_image_id
    AND image.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  -- Serialize the last-image check with inserts protected by the message FK.
  SELECT message.id
  INTO v_locked_message_id
  FROM public.messages AS message
  WHERE message.id = v_message_id
    AND message.user_id = v_user_id
    AND message.role = 'assistant'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_MESSAGE_NOT_FOUND';
  END IF;

  DELETE FROM public.message_generated_images AS image
  WHERE image.id = p_generated_image_id
    AND image.user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  DELETE FROM public.messages AS message
  WHERE message.id = v_message_id
    AND message.user_id = v_user_id
    AND message.role = 'assistant'
    AND btrim(message.content) = ''
    AND COALESCE(message.documents, '[]'::jsonb) = '[]'::jsonb
    AND message.image_path IS NULL
    AND message.image_name IS NULL
    AND (message.sources IS NULL OR message.sources = '[]'::jsonb)
    AND (message.source_count IS NULL OR message.source_count = 0)
    AND message.widget IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.message_generated_images AS sibling
      WHERE sibling.message_id = message.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.message_images AS uploaded_image
      WHERE uploaded_image.message_id = message.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.generated_documents AS document
      WHERE document.message_id = message.id
    );

  v_message_deleted := FOUND;
  RETURN QUERY SELECT true, v_message_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_generated_image_metadata(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_generated_image_metadata(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_generated_image_metadata(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_generated_image_metadata(uuid) IS
  'Deletes one owned generated image and removes its empty assistant message only when no sibling image or other artifact remains.';

COMMIT;
