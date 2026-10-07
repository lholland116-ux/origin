BEGIN;

-- This reserved assistant content is the pending marker for this lifecycle.
-- Application history readers omit it until finalization; legacy empty
-- assistant rows may carry images and remain visible.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.messages
    WHERE left(content, char_length('[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:'))
      = '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:'
  ) THEN
    RAISE EXCEPTION 'The reserved pending assistant marker is already in use.';
  END IF;
END;
$guard$;

-- The existing runtime store may remove userInput after its last consumer,
-- but the request-to-message identity must never be rebound after creation.
CREATE OR REPLACE FUNCTION public.prevent_execution_run_plan_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.runtime_version IS DISTINCT FROM OLD.runtime_version
     OR NEW.handoff_version IS DISTINCT FROM OLD.handoff_version
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.execution_plan IS DISTINCT FROM OLD.execution_plan
     OR NEW.runtime_context -> 'requestMessageBinding'
        IS DISTINCT FROM OLD.runtime_context -> 'requestMessageBinding' THEN
    RAISE EXCEPTION 'Execution plan identity is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.create_agent_assistant_message_destination(
  p_request_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_message_created_at timestamptz;
  v_assistant_message_id uuid;
  v_existing_assistant_message_id uuid;
  v_existing_content text;
  v_existing_conversation_id uuid;
  v_existing_request_id text;
  v_existing_user_message_id text;
  v_existing_assistant_id text;
  v_existing_binding_conversation_id text;
  v_request_marker_prefix text;
  v_pending_marker text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF p_request_id IS NULL OR p_conversation_id IS NULL OR p_user_message_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_REQUEST_MESSAGE_BINDING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations AS conversation
    WHERE conversation.id = p_conversation_id AND conversation.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  SELECT message.created_at INTO v_user_message_created_at
  FROM public.messages AS message
  WHERE message.id = p_user_message_id
    AND message.conversation_id = p_conversation_id
    AND message.user_id = v_user_id
    AND message.role = 'user'
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_MESSAGE_NOT_FOUND';
  END IF;

  v_request_marker_prefix := '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:' || p_request_id::text || ':';
  v_pending_marker := v_request_marker_prefix || p_user_message_id::text || ']]';
  PERFORM pg_advisory_xact_lock(hashtextextended('agent-message-binding:' || p_request_id::text, 0));

  SELECT
    run.runtime_context #>> '{requestMessageBinding,requestId}',
    run.runtime_context #>> '{requestMessageBinding,userMessageId}',
    run.runtime_context #>> '{requestMessageBinding,assistantMessageId}',
    run.runtime_context #>> '{requestMessageBinding,conversationId}'
  INTO
    v_existing_request_id,
    v_existing_user_message_id,
    v_existing_assistant_id,
    v_existing_binding_conversation_id
  FROM public.execution_runs AS run
  WHERE run.user_id = v_user_id
    AND run.runtime_context #>> '{requestMessageBinding,requestId}' = p_request_id::text
  ORDER BY run.created_at
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_request_id IS DISTINCT FROM p_request_id::text
       OR v_existing_user_message_id IS DISTINCT FROM p_user_message_id::text
       OR v_existing_binding_conversation_id IS DISTINCT FROM p_conversation_id::text
       OR v_existing_assistant_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_ID_BINDING_CONFLICT';
    END IF;

    v_existing_assistant_message_id := v_existing_assistant_id::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.messages AS message
      WHERE message.id = v_existing_assistant_message_id
        AND message.conversation_id = p_conversation_id
        AND message.user_id = v_user_id
        AND message.role = 'assistant'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ASSISTANT_MESSAGE_NOT_FOUND';
    END IF;
    RETURN v_existing_assistant_message_id;
  END IF;

  SELECT message.id, message.content, message.conversation_id
  INTO v_existing_assistant_message_id, v_existing_content, v_existing_conversation_id
  FROM public.messages AS message
  WHERE message.user_id = v_user_id
    AND message.role = 'assistant'
    AND left(message.content, char_length(v_request_marker_prefix)) = v_request_marker_prefix
  ORDER BY message.created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_content IS DISTINCT FROM v_pending_marker
       OR v_existing_conversation_id IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_ID_BINDING_CONFLICT';
    END IF;
    RETURN v_existing_assistant_message_id;
  END IF;

  INSERT INTO public.messages (conversation_id, user_id, role, content, documents, created_at)
  VALUES (
    p_conversation_id,
    v_user_id,
    'assistant',
    v_pending_marker,
    '[]'::jsonb,
    GREATEST(clock_timestamp(), v_user_message_created_at + interval '1 microsecond')
  )
  RETURNING id INTO v_assistant_message_id;

  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = p_conversation_id AND user_id = v_user_id;

  RETURN v_assistant_message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_agent_assistant_message_destination(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_agent_assistant_message_destination(uuid, uuid, uuid)
  TO authenticated;
COMMENT ON FUNCTION public.create_agent_assistant_message_destination(uuid, uuid, uuid)
  IS 'Idempotently creates one owned, request- and user-message-bound hidden assistant destination.';

CREATE FUNCTION public.validate_agent_request_message_binding(
  p_request_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid,
  p_assistant_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_message_created_at timestamptz;
  v_assistant_message_created_at timestamptz;
  v_assistant_content text;
  v_pending_marker text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF p_request_id IS NULL OR p_conversation_id IS NULL OR p_user_message_id IS NULL
     OR p_assistant_message_id IS NULL OR p_user_message_id = p_assistant_message_id THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations AS conversation
    WHERE conversation.id = p_conversation_id AND conversation.user_id = v_user_id
  ) THEN
    RETURN false;
  END IF;

  SELECT message.created_at INTO v_user_message_created_at
  FROM public.messages AS message
  WHERE message.id = p_user_message_id
    AND message.conversation_id = p_conversation_id
    AND message.user_id = v_user_id
    AND message.role = 'user';

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT message.created_at, message.content
  INTO v_assistant_message_created_at, v_assistant_content
  FROM public.messages AS message
  WHERE message.id = p_assistant_message_id
    AND message.conversation_id = p_conversation_id
    AND message.user_id = v_user_id
    AND message.role = 'assistant';

  IF NOT FOUND THEN RETURN false; END IF;

  v_pending_marker := '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:'
    || p_request_id::text || ':' || p_user_message_id::text || ']]';

  RETURN v_assistant_message_created_at >= v_user_message_created_at
    AND (
      v_assistant_content = v_pending_marker
      OR EXISTS (
        SELECT 1 FROM public.execution_runs AS run
        WHERE run.user_id = v_user_id
          AND run.runtime_context #>> '{requestMessageBinding,requestId}' = p_request_id::text
          AND run.runtime_context #>> '{requestMessageBinding,userId}' = v_user_id::text
          AND run.runtime_context #>> '{requestMessageBinding,conversationId}' = p_conversation_id::text
          AND run.runtime_context #>> '{requestMessageBinding,userMessageId}' = p_user_message_id::text
          AND run.runtime_context #>> '{requestMessageBinding,assistantMessageId}' = p_assistant_message_id::text
      )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_agent_request_message_binding(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_agent_request_message_binding(uuid, uuid, uuid, uuid)
  TO authenticated;
COMMENT ON FUNCTION public.validate_agent_request_message_binding(uuid, uuid, uuid, uuid)
  IS 'Validates exact request/user-message association plus owned, conversation-bound user/assistant rows.';

CREATE FUNCTION public.finalize_agent_assistant_message(
  p_request_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid,
  p_assistant_message_id uuid,
  p_final_text text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_message_created_at timestamptz;
  v_assistant_message_created_at timestamptz;
  v_existing_content text;
  v_pending_marker text;
  v_exact_binding_exists boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
  END IF;

  IF p_request_id IS NULL OR p_conversation_id IS NULL OR p_user_message_id IS NULL
     OR p_assistant_message_id IS NULL OR p_user_message_id = p_assistant_message_id
     OR p_final_text IS NULL OR btrim(p_final_text) = ''
     OR left(p_final_text, char_length('[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:'))
        = '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:'
     OR length(p_final_text) > 200000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ASSISTANT_FINALIZATION';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations AS conversation
    WHERE conversation.id = p_conversation_id AND conversation.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONVERSATION_NOT_FOUND';
  END IF;

  SELECT message.created_at INTO v_user_message_created_at
  FROM public.messages AS message
  WHERE message.id = p_user_message_id
    AND message.conversation_id = p_conversation_id
    AND message.user_id = v_user_id
    AND message.role = 'user'
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_MESSAGE_NOT_FOUND';
  END IF;

  SELECT message.created_at, message.content
  INTO v_assistant_message_created_at, v_existing_content
  FROM public.messages AS message
  WHERE message.id = p_assistant_message_id
    AND message.conversation_id = p_conversation_id
    AND message.user_id = v_user_id
    AND message.role = 'assistant'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ASSISTANT_MESSAGE_NOT_FOUND';
  END IF;

  IF v_assistant_message_created_at < v_user_message_created_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MESSAGE_LINKAGE_INVALID';
  END IF;

  v_pending_marker := '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:'
    || p_request_id::text || ':' || p_user_message_id::text || ']]';

  SELECT EXISTS (
    SELECT 1 FROM public.execution_runs AS run
    WHERE run.user_id = v_user_id
      AND run.runtime_context #>> '{requestMessageBinding,requestId}' = p_request_id::text
      AND run.runtime_context #>> '{requestMessageBinding,userId}' = v_user_id::text
      AND run.runtime_context #>> '{requestMessageBinding,conversationId}' = p_conversation_id::text
      AND run.runtime_context #>> '{requestMessageBinding,userMessageId}' = p_user_message_id::text
      AND run.runtime_context #>> '{requestMessageBinding,assistantMessageId}' = p_assistant_message_id::text
  ) INTO v_exact_binding_exists;

  IF v_existing_content <> v_pending_marker AND NOT v_exact_binding_exists THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MESSAGE_FINALIZATION_CONFLICT';
  END IF;

  IF v_existing_content = p_final_text THEN
    RETURN p_assistant_message_id;
  END IF;

  IF v_existing_content <> v_pending_marker THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MESSAGE_FINALIZATION_CONFLICT';
  END IF;

  UPDATE public.messages
  SET content = p_final_text
  WHERE id = p_assistant_message_id
    AND user_id = v_user_id
    AND conversation_id = p_conversation_id
    AND role = 'assistant'
    AND content = v_pending_marker;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MESSAGE_FINALIZATION_CONFLICT';
  END IF;

  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = p_conversation_id AND user_id = v_user_id;

  RETURN p_assistant_message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_agent_assistant_message(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_agent_assistant_message(uuid, uuid, uuid, uuid, text)
  TO authenticated;
COMMENT ON FUNCTION public.finalize_agent_assistant_message(uuid, uuid, uuid, uuid, text)
  IS 'Finalizes the same owned assistant-message destination exactly once; identical replay is safe.';

COMMIT;
