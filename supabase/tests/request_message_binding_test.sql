begin;

create extension if not exists pgtap;

select plan(24);

select has_function(
  'public',
  'create_agent_assistant_message_destination',
  array['uuid', 'uuid', 'uuid'],
  'assistant destination creation RPC exists'
);
select has_function(
  'public',
  'validate_agent_request_message_binding',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'request message binding validation RPC exists'
);
select has_function(
  'public',
  'finalize_agent_assistant_message',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'same-message finalization RPC exists'
);

select ok(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.create_agent_assistant_message_destination(uuid,uuid,uuid)'::regprocedure),
  'destination creation runs with a fixed definer context'
);
select ok(
  has_function_privilege('authenticated', 'public.create_agent_assistant_message_destination(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_agent_assistant_message_destination(uuid,uuid,uuid)', 'EXECUTE')
  and not coalesce((
    select bool_or(acl.privilege_type = 'EXECUTE')
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
    where procedure.oid = 'public.create_agent_assistant_message_destination(uuid,uuid,uuid)'::regprocedure
      and acl.grantee = 0
  ), false),
  'only authenticated callers can create a destination'
);
select ok(
  has_function_privilege('authenticated', 'public.finalize_agent_assistant_message(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_agent_assistant_message(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  and not coalesce((
    select bool_or(acl.privilege_type = 'EXECUTE')
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
    where procedure.oid = 'public.finalize_agent_assistant_message(uuid,uuid,uuid,uuid,text)'::regprocedure
      and acl.grantee = 0
  ), false),
  'only authenticated callers can finalize a destination'
);

insert into auth.users (id, aud, role, email)
values
  ('a1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'binding-owner@example.test'),
  ('a1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'binding-other@example.test');

insert into public.conversations (id, user_id, title)
values
  ('b1100000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'Binding owner'),
  ('b1100000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000002', 'Binding other');

insert into public.messages (id, conversation_id, user_id, role, content)
values
  ('c1100000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'user', 'Original request'),
  ('c1100000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000002', 'user', 'Other request'),
  ('c1100000-0000-4000-8000-000000000003', 'b1100000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000002', 'assistant', 'Cross-owned message'),
  ('c1100000-0000-4000-8000-000000000004', 'b1100000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'user', 'Second request');

select set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000001', true);
set local role authenticated;

create temporary table request_binding_result on commit drop as
select public.create_agent_assistant_message_destination(
  'd1100000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001'
) as assistant_message_id;

select ok(
  (select message.role = 'assistant'
     and message.content = '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:d1100000-0000-4000-8000-000000000001:c1100000-0000-4000-8000-000000000001]]'
     and message.user_id = 'a1100000-0000-4000-8000-000000000001'::uuid
     and message.conversation_id = 'b1100000-0000-4000-8000-000000000001'::uuid
   from public.messages message join request_binding_result r on r.assistant_message_id = message.id),
  'creation persists one real, owned, hidden assistant destination'
);
select is(
  public.create_agent_assistant_message_destination(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001'
  ),
  (select assistant_message_id from request_binding_result),
  'same request/user-message retry reuses its single assistant destination'
);
select throws_ok(
  $$select public.create_agent_assistant_message_destination(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000004'
  )$$,
  'P0001',
  'REQUEST_ID_BINDING_CONFLICT',
  'same request ID cannot be rebound to a different user message'
);
select ok(
  (select public.validate_agent_request_message_binding(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    assistant_message_id
  ) from request_binding_result),
  'the owned ordered user/assistant pair validates'
);
select ok(
  not (select public.validate_agent_request_message_binding(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    assistant_message_id,
    'c1100000-0000-4000-8000-000000000001'
  ) from request_binding_result),
  'roles cannot be reversed'
);
select ok(
  not (select public.validate_agent_request_message_binding(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000002',
    assistant_message_id
  ) from request_binding_result),
  'cross-user message IDs are rejected'
);
select ok(
  not (select public.validate_agent_request_message_binding(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000003'
  )),
  'an assistant row with mismatched user ownership is rejected'
);
select ok(
  not (select public.validate_agent_request_message_binding(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000002',
    'c1100000-0000-4000-8000-000000000001',
    assistant_message_id
  ) from request_binding_result),
  'cross-conversation message IDs are rejected'
);
select ok(
  not (select public.validate_agent_request_message_binding(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000099'
  )),
  'nonexistent assistant IDs are rejected'
);

reset role;
insert into public.execution_runs (
  id,
  user_id,
  handoff_version,
  idempotency_key,
  request_fingerprint,
  execution_plan,
  runtime_context,
  snapshot
)
values (
  'd2200000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000001',
  1,
  'request-message-binding-test',
  repeat('f', 64),
  '{"steps":[],"orderedStepIds":[]}'::jsonb,
  jsonb_build_object('requestMessageBinding', jsonb_build_object(
    'requestId', 'd1100000-0000-4000-8000-000000000001',
    'userId', 'a1100000-0000-4000-8000-000000000001',
    'conversationId', 'b1100000-0000-4000-8000-000000000001',
    'userMessageId', 'c1100000-0000-4000-8000-000000000001',
    'assistantMessageId', (select assistant_message_id::text from request_binding_result)
  )),
  '{}'::jsonb
);
set local role authenticated;

select is(
  (select public.finalize_agent_assistant_message(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    assistant_message_id,
    'Final request response'
  ) from request_binding_result),
  (select assistant_message_id from request_binding_result),
  'finalization updates the existing assistant message ID'
);
select is(
  (select message.content from public.messages message
   join request_binding_result r on r.assistant_message_id = message.id),
  'Final request response',
  'final text is stored on the same assistant row'
);
select ok(
  public.validate_agent_request_message_binding(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    (select assistant_message_id from request_binding_result)
  ),
  'persisted request binding remains valid after assistant finalization'
);
select is(
  (select count(*)::integer from public.messages
   where user_id = 'a1100000-0000-4000-8000-000000000001'
     and conversation_id = 'b1100000-0000-4000-8000-000000000001'
     and role = 'assistant'),
  1,
  'finalization creates no additional assistant message'
);
select is(
  (select public.finalize_agent_assistant_message(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    assistant_message_id,
    'Final request response'
  ) from request_binding_result),
  (select assistant_message_id from request_binding_result),
  'same-content finalization replay is idempotent'
);
select throws_ok(
  $$select public.finalize_agent_assistant_message(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    (select assistant_message_id from request_binding_result),
    'Conflicting response'
  )$$,
  'P0001',
  'MESSAGE_FINALIZATION_CONFLICT',
  'conflicting finalization replay fails closed'
);
select throws_ok(
  $$select public.finalize_agent_assistant_message(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000004',
    'Wrong role'
  )$$,
  'P0001',
  'ASSISTANT_MESSAGE_NOT_FOUND',
  'finalization rejects a user row in the assistant role slot'
);
select throws_ok(
  $$select public.finalize_agent_assistant_message(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000002',
    'c1100000-0000-4000-8000-000000000001',
    (select assistant_message_id from request_binding_result),
    'Wrong conversation'
  )$$,
  'P0001',
  'CONVERSATION_NOT_FOUND',
  'finalization rejects a conversation not owned by the caller'
);
select throws_ok(
  $$select public.finalize_agent_assistant_message(
    'd1100000-0000-4000-8000-000000000001',
    'b1100000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    (select assistant_message_id from request_binding_result),
    '[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:invalid]]'
  )$$,
  '22023',
  'INVALID_ASSISTANT_FINALIZATION',
  'the reserved pending marker cannot be finalized as user-visible content'
);

select * from finish();
rollback;
