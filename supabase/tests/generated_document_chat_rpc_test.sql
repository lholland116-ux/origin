begin;

create extension if not exists pgtap;

select plan(7);

select has_function(
  'public',
  'persist_generated_document_chat',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'bigint', 'text', 'text'],
  'authenticated generated-document persistence RPC exists'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)'::regprocedure
  ),
  'persistence RPC is SECURITY DEFINER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)',
    'EXECUTE'
  ),
  'authenticated clients can execute persistence RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute persistence RPC'
);

select ok(
  not has_function_privilege(
    'public',
    'public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)',
    'EXECUTE'
  ),
  'PUBLIC cannot execute persistence RPC'
);

select ok(
  lower(pg_get_functiondef('public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)'::regprocedure))
    like '%auth.uid()%'
    and lower(pg_get_functiondef('public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)'::regprocedure))
      like '%conversation%'
    and lower(pg_get_functiondef('public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)'::regprocedure))
      like '%pg_advisory_xact_lock%'
  ,
  'persistence RPC derives identity, verifies conversation ownership, and serializes retries'
);

select ok(
  lower(pg_get_functiondef('public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)'::regprocedure))
    like '%generated_documents%'
    and lower(pg_get_functiondef('public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)'::regprocedure))
      like '%messages%'
  ,
  'persistence RPC links the assistant message and generated-document row'
);

select * from finish();

rollback;
