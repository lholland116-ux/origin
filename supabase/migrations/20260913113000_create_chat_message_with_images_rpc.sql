-- Atomically persist a stored-image chat turn and its ordered attachment rows.

CREATE OR REPLACE FUNCTION public.create_chat_message_with_images(
  p_conversation_id uuid,
  p_content         text,
  p_documents       jsonb,
  p_images          jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_user_id          uuid;
  v_plan             text;
  v_image_count      integer;
  v_image_limit      integer;
  v_storage_namespace text;
  v_message_id       uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations
    WHERE id = p_conversation_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  IF p_images IS NULL OR jsonb_typeof(p_images) <> 'array' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INVALID_IMAGES';
  END IF;

  SELECT count(*)::integer
  INTO v_image_count
  FROM jsonb_array_elements(p_images);

  IF v_image_count = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INVALID_IMAGES';
  END IF;

  SELECT plan
  INTO v_plan
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_plan IS NULL OR v_plan NOT IN ('free', 'pro') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PLAN_UNAVAILABLE';
  END IF;

  v_image_limit := CASE WHEN v_plan = 'pro' THEN 3 ELSE 1 END;

  IF v_image_count > v_image_limit OR v_image_count > 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'IMAGE_LIMIT_EXCEEDED';
  END IF;

  v_storage_namespace := v_user_id::text || '/';

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_images) AS image(item)
    WHERE jsonb_typeof(image.item) <> 'object'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INVALID_IMAGES';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_images) AS image(item)
    WHERE NOT (image.item ? 'storage_path')
       OR NOT (image.item ? 'image_name')
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(image.item) AS key_name
         WHERE key_name NOT IN ('storage_path', 'image_name')
       )
       OR btrim(image.item->>'storage_path') = ''
       OR btrim(image.item->>'image_name') = ''
       OR length(image.item->>'storage_path') > 500
       OR length(image.item->>'image_name') > 255
       OR left(image.item->>'storage_path', length(v_storage_namespace)) <> v_storage_namespace
       OR position('..' in image.item->>'storage_path') > 0
       OR position(chr(92) in image.item->>'storage_path') > 0
       OR position('//' in image.item->>'storage_path') > 0
       OR right(image.item->>'storage_path', 1) = '/'
       OR (image.item->>'storage_path') ~ '[[:cntrl:]]'
       OR (image.item->>'image_name') ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INVALID_IMAGE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_images) AS image(item)
    GROUP BY image.item->>'storage_path'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'DUPLICATE_IMAGE';
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
    coalesce(p_documents, '[]'::jsonb)
  )
  RETURNING id INTO v_message_id;

  INSERT INTO public.message_images (
    message_id,
    storage_path,
    image_name,
    ordinal
  )
  SELECT
    v_message_id,
    image.item->>'storage_path',
    image.item->>'image_name',
    image.ordinal::integer
  FROM jsonb_array_elements(p_images) WITH ORDINALITY AS image(item, ordinal);

  RETURN v_message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_chat_message_with_images(uuid, text, jsonb, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_chat_message_with_images(uuid, text, jsonb, jsonb) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_chat_message_with_images(uuid, text, jsonb, jsonb) TO authenticated;
