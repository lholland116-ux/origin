BEGIN;

-- Extend the existing trusted persistence boundary to accept the XLSX contract
-- already enforced by generated_documents. CREATE OR REPLACE preserves the
-- function owner and existing ACLs; the grants below restate the intended
-- service-role-only execution boundary.
CREATE OR REPLACE FUNCTION public.persist_trusted_generated_document_for_execution(
  p_run_id uuid, p_step_id text, p_execution_key uuid, p_claim_id uuid, p_fencing_generation bigint,
  p_generated_document_id uuid, p_storage_path text, p_filename text, p_format text,
  p_mime_type text, p_size_bytes bigint, p_template_id text
)
RETURNS TABLE (assistant_message_id uuid, generated_document_id uuid, was_existing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_subject record;
  v_existing public.generated_documents%ROWTYPE;
  v_expected_path text;
  v_mime text;
BEGIN
  SELECT * INTO v_subject FROM public.resolve_trusted_agent_execution_subject(
    p_run_id, p_step_id, p_execution_key, p_claim_id, p_fencing_generation
  );
  IF v_subject.capability_id <> 'document_generation' OR p_generated_document_id IS NULL
     OR p_template_id IS NULL
     OR length(p_template_id) NOT BETWEEN 1 AND 128 OR p_size_bytes NOT BETWEEN 1 AND 10485760
     OR p_format NOT IN ('txt', 'md', 'docx', 'pdf', 'xlsx')
     OR p_filename IS NULL OR p_filename <> pg_catalog.btrim(p_filename)
     OR length(p_filename) NOT BETWEEN 1 AND 160 OR position('@' in p_filename) > 0
     OR position('/' in p_filename) > 0 OR position(chr(92) in p_filename) > 0
     OR position('..' in p_filename) > 0 OR p_filename ~ '[[:cntrl:]]'
     OR p_mime_type NOT IN ('text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_DOCUMENT';
  END IF;
  v_mime := CASE p_format WHEN 'txt' THEN 'text/plain' WHEN 'md' THEN 'text/markdown'
    WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ELSE 'application/pdf' END;
  v_expected_path := v_subject.user_id::text || '/' || v_subject.conversation_id::text
    || '/generated/' || p_generated_document_id::text || '/' || p_filename;
  IF p_mime_type <> v_mime OR p_storage_path IS DISTINCT FROM v_expected_path THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GENERATED_DOCUMENT_PATH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects AS object
    WHERE object.bucket_id = 'documents' AND object.name = p_storage_path) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'GENERATED_DOCUMENT_OBJECT_MISSING';
  END IF;
  PERFORM 1 FROM public.messages AS message WHERE message.id = v_subject.assistant_message_id
    AND message.user_id = v_subject.user_id AND message.conversation_id = v_subject.conversation_id
    AND message.role = 'assistant' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ASSISTANT_MESSAGE_UNAVAILABLE'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_subject.user_id::text || ':' || v_subject.conversation_id::text || ':' || p_execution_key::text, 0));
  SELECT document.* INTO v_existing FROM public.generated_documents AS document
  WHERE document.user_id = v_subject.user_id AND document.conversation_id = v_subject.conversation_id
    AND document.generation_request_id = p_execution_key;
  IF FOUND THEN
    IF v_existing.message_id <> v_subject.assistant_message_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'GENERATED_DOCUMENT_LINKAGE_CONFLICT';
    END IF;
    RETURN QUERY SELECT v_existing.message_id, v_existing.id, true;
    RETURN;
  END IF;
  INSERT INTO public.generated_documents (id,user_id,conversation_id,message_id,generation_request_id,
    storage_path,filename,format,mime_type,size_bytes,template_id)
  VALUES (p_generated_document_id,v_subject.user_id,v_subject.conversation_id,v_subject.assistant_message_id,
    p_execution_key,p_storage_path,p_filename,p_format,p_mime_type,p_size_bytes,p_template_id);
  RETURN QUERY SELECT v_subject.assistant_message_id,p_generated_document_id,false;
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)
  TO service_role;

COMMIT;
