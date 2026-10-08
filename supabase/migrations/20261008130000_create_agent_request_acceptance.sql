BEGIN;

-- This ledger is the durable idempotency boundary for Agent Runtime V1
-- acceptance. It deliberately stores references/options rather than another
-- copy of message text or uploaded file bytes.
CREATE TABLE public.agent_request_acceptances (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  request_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage_date date NOT NULL,
  user_message_id uuid NOT NULL,
  assistant_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_request_acceptances_user_key UNIQUE (user_id, idempotency_key),
  CONSTRAINT agent_request_acceptances_user_request UNIQUE (user_id, request_id),
  CONSTRAINT agent_request_acceptances_user_message UNIQUE (user_message_id),
  CONSTRAINT agent_request_acceptances_assistant_message UNIQUE (assistant_message_id),
  CONSTRAINT agent_request_acceptances_distinct_messages CHECK (user_message_id <> assistant_message_id),
  CONSTRAINT agent_request_acceptances_key_check CHECK (
    length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key = btrim(idempotency_key)
    AND idempotency_key !~ '[[:cntrl:]]'
  ),
  CONSTRAINT agent_request_acceptances_fingerprint_check CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT agent_request_acceptances_options_check CHECK (
    jsonb_typeof(request_options) = 'object'
    AND octet_length(request_options::text) <= 8192
  )
);

CREATE INDEX agent_request_acceptances_user_created_idx
  ON public.agent_request_acceptances (user_id, created_at DESC);

ALTER TABLE public.agent_request_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_request_acceptances FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_request_acceptances FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prevent_agent_request_acceptance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Agent request acceptance identity is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER agent_request_acceptances_immutable
  BEFORE UPDATE ON public.agent_request_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.prevent_agent_request_acceptance_mutation();

REVOKE ALL ON FUNCTION public.prevent_agent_request_acceptance_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- This deliberately extends the existing assistant-destination convention in
-- the same transaction as quota + user-message persistence. The older
-- create_agent_assistant_message_destination RPC remains unchanged because it
-- is a separately callable, authenticated operation and cannot atomically
-- include the request ledger and daily usage reservation.
CREATE FUNCTION public.accept_agent_request(
  p_user_id uuid,
  p_conversation_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_request_options jsonb,
  p_message text,
  p_document_ids uuid[],
  p_images jsonb,
  p_usage_date date,
  p_free_daily_limit integer,
  p_pro_daily_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing public.agent_request_acceptances%ROWTYPE;
  v_request_id uuid;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_user_message_created_at timestamptz;
  v_user_plan text;
  v_daily_limit integer;
  v_allowed boolean;
  v_message_count integer;
  v_images jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_document_count integer;
  v_image_count integer;
  v_image_limit integer;
  v_stored_content text;
  v_attachment_notes text[] := ARRAY[]::text[];
BEGIN
  IF p_user_id IS NULL OR p_conversation_id IS NULL
     OR p_idempotency_key IS NULL
     OR length(p_idempotency_key) NOT BETWEEN 1 AND 128
     OR p_idempotency_key <> btrim(p_idempotency_key)
     OR p_idempotency_key ~ '[[:cntrl:]]'
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_request_options IS NULL
     OR jsonb_typeof(p_request_options) <> 'object'
     OR octet_length(p_request_options::text) > 8192
     OR p_message IS NULL
     OR btrim(p_message) = ''
     OR length(p_message) > 20000
     OR p_usage_date IS NULL
     OR p_free_daily_limit IS NULL OR p_free_daily_limit < 1
     OR p_pro_daily_limit IS NULL OR p_pro_daily_limit < 1
     OR p_document_ids IS NULL
     OR cardinality(p_document_ids) > 10
     OR p_images IS NULL OR jsonb_typeof(p_images) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_REQUEST_ACCEPTANCE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_request_options) AS option_key
    WHERE option_key NOT IN ('routingMode', 'reasoningMode')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_REQUEST_OPTIONS';
  END IF;

  IF p_request_options ? 'routingMode'
     AND (jsonb_typeof(p_request_options->'routingMode') <> 'string'
       OR p_request_options->>'routingMode' NOT IN ('auto', 'standard', 'web_search', 'image_generation', 'image_editing', 'file_analysis', 'document_generation')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_REQUEST_OPTIONS';
  END IF;

  IF p_request_options ? 'reasoningMode'
     AND (jsonb_typeof(p_request_options->'reasoningMode') <> 'string'
       OR p_request_options->>'reasoningMode' NOT IN ('adaptive', 'none', 'low', 'medium', 'high', 'xhigh', 'max')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AGENT_REQUEST_OPTIONS';
  END IF;

  IF cardinality(p_document_ids) <> (
    SELECT count(DISTINCT document_id)::integer
    FROM unnest(p_document_ids) AS document_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DUPLICATE_DOCUMENT';
  END IF;

  v_images := p_images;
  IF octet_length(v_images::text) > 8192 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_IMAGES';
  END IF;
  SELECT jsonb_array_length(v_images) INTO v_image_count;
  IF v_image_count > 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IMAGE_LIMIT_EXCEEDED';
  END IF;

  -- Serialize same-user/same-key requests before checking the ledger. A hash
  -- collision only causes harmless extra serialization; uniqueness remains
  -- enforced by the table constraint as a second line of defense.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('agent-request:' || p_user_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT acceptance.* INTO v_existing
  FROM public.agent_request_acceptances AS acceptance
  WHERE acceptance.user_id = p_user_id
    AND acceptance.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object(
      'kind', 'accepted',
      'replayed', true,
      'idempotencyKey', v_existing.idempotency_key,
      'requestId', v_existing.request_id,
      'userId', v_existing.user_id,
      'conversationId', v_existing.conversation_id,
      'userMessageId', v_existing.user_message_id,
      'assistantMessageId', v_existing.assistant_message_id,
      'usageDate', v_existing.usage_date
    );
  END IF;

  SELECT profile.plan INTO v_user_plan
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROFILE_UNAVAILABLE';
  END IF;
  IF v_user_plan IS NULL OR v_user_plan NOT IN ('free', 'pro') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAN_UNAVAILABLE';
  END IF;

  PERFORM 1
  FROM public.conversations AS conversation
  WHERE conversation.id = p_conversation_id
    AND conversation.user_id = p_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  IF cardinality(p_document_ids) > 0 THEN
    SELECT count(*)::integer INTO v_document_count
    FROM public.documents AS document
    WHERE document.user_id = p_user_id
      AND document.conversation_id = p_conversation_id
      AND document.extraction_status = 'ready'
      AND document.id = ANY (p_document_ids);
    IF v_document_count <> cardinality(p_document_ids) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DOCUMENT_UNAVAILABLE';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', document.id,
      'file_name', document.file_name,
      'mime_type', document.mime_type,
      'size_bytes', document.size_bytes,
      'extraction_status', document.extraction_status,
      'extraction_error', NULL,
      'conversation_id', document.conversation_id
    ) ORDER BY selected.ordinality), '[]'::jsonb)
    INTO v_documents
    FROM unnest(p_document_ids) WITH ORDINALITY AS selected(document_id, ordinality)
    JOIN public.documents AS document
      ON document.id = selected.document_id
     AND document.user_id = p_user_id
     AND document.conversation_id = p_conversation_id
     AND document.extraction_status = 'ready';
    v_attachment_notes := array_append(v_attachment_notes,
      '[Documents attached: ' || (
        SELECT string_agg(document.file_name, ', ' ORDER BY selected.ordinality)
        FROM unnest(p_document_ids) WITH ORDINALITY AS selected(document_id, ordinality)
        JOIN public.documents AS document
          ON document.id = selected.document_id AND document.user_id = p_user_id
      ) || ']');
  END IF;

  IF v_image_count > 0 THEN
    v_image_limit := CASE WHEN v_user_plan = 'pro' THEN 3 ELSE 1 END;
    IF v_image_count > v_image_limit THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IMAGE_LIMIT_EXCEEDED';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_images) AS image(item)
      WHERE jsonb_typeof(image.item) <> 'object'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_IMAGE';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_images) AS image(item)
      WHERE NOT (image.item ? 'storage_path')
        OR NOT (image.item ? 'image_name')
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(image.item) AS image_key
          WHERE image_key NOT IN ('storage_path', 'image_name')
        )
        OR coalesce(btrim(image.item->>'storage_path'), '') = ''
        OR coalesce(btrim(image.item->>'image_name'), '') = ''
        OR length(image.item->>'storage_path') > 500
        OR length(image.item->>'image_name') > 255
        OR left(image.item->>'storage_path', length(p_user_id::text || '/')) <> p_user_id::text || '/'
        OR position('..' in image.item->>'storage_path') > 0
        OR position(chr(92) in image.item->>'storage_path') > 0
        OR position('//' in image.item->>'storage_path') > 0
        OR right(image.item->>'storage_path', 1) = '/'
        OR (image.item->>'storage_path') ~ '[[:cntrl:]]'
        OR (image.item->>'image_name') ~ '[[:cntrl:]]'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_IMAGE';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_images) AS image(item)
      GROUP BY image.item->>'storage_path'
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DUPLICATE_IMAGE';
    END IF;
    v_attachment_notes := array_append(v_attachment_notes,
      CASE WHEN v_image_count > 1 THEN '[Images attached]' ELSE '[Image attached]' END);
  END IF;

  v_daily_limit := CASE WHEN v_user_plan = 'pro' THEN p_pro_daily_limit ELSE p_free_daily_limit END;
  SELECT reservation.allowed, reservation.message_count
    INTO v_allowed, v_message_count
  FROM public.reserve_daily_usage(p_user_id, p_usage_date, v_daily_limit) AS reservation;
  IF NOT coalesce(v_allowed, false) THEN
    RETURN jsonb_build_object('kind', 'limit_reached', 'messageCount', v_message_count);
  END IF;

  v_stored_content := btrim(p_message);
  IF cardinality(v_attachment_notes) > 0 THEN
    v_stored_content := concat_ws(E'\n\n', v_stored_content, array_to_string(v_attachment_notes, E'\n'));
  END IF;

  INSERT INTO public.messages (conversation_id, user_id, role, content, documents)
  VALUES (p_conversation_id, p_user_id, 'user', v_stored_content, v_documents)
  RETURNING id, created_at INTO v_user_message_id, v_user_message_created_at;

  IF v_image_count > 0 THEN
    INSERT INTO public.message_images (message_id, storage_path, image_name, ordinal)
    SELECT
      v_user_message_id,
      image.item->>'storage_path',
      image.item->>'image_name',
      image.ordinal::integer
    FROM jsonb_array_elements(v_images) WITH ORDINALITY AS image(item, ordinal);
  END IF;

  v_request_id := gen_random_uuid();
  INSERT INTO public.messages (conversation_id, user_id, role, content, documents, created_at)
  VALUES (
    p_conversation_id,
    p_user_id,
    'assistant',
    '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:' || v_request_id::text || ':' || v_user_message_id::text || ']]',
    '[]'::jsonb,
    greatest(clock_timestamp(), v_user_message_created_at + interval '1 microsecond')
  )
  RETURNING id INTO v_assistant_message_id;

  INSERT INTO public.agent_request_acceptances (
    request_id, user_id, conversation_id, idempotency_key,
    request_fingerprint, request_options, usage_date,
    user_message_id, assistant_message_id
  ) VALUES (
    v_request_id, p_user_id, p_conversation_id, p_idempotency_key,
    p_request_fingerprint, p_request_options, p_usage_date,
    v_user_message_id, v_assistant_message_id
  );

  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = p_conversation_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'kind', 'accepted',
    'replayed', false,
    'idempotencyKey', p_idempotency_key,
    'requestId', v_request_id,
    'userId', p_user_id,
    'conversationId', p_conversation_id,
    'userMessageId', v_user_message_id,
    'assistantMessageId', v_assistant_message_id,
    'usageDate', p_usage_date
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_agent_request(uuid, uuid, text, text, jsonb, text, uuid[], jsonb, date, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_agent_request(uuid, uuid, text, text, jsonb, text, uuid[], jsonb, date, integer, integer)
  TO service_role;
COMMENT ON FUNCTION public.accept_agent_request(uuid, uuid, text, text, jsonb, text, uuid[], jsonb, date, integer, integer)
  IS 'Atomically reserves one daily message and persists one idempotent Agent Runtime request with an immutable user/assistant message binding. Service-role only; caller must verify the authenticated user first.';

COMMIT;
