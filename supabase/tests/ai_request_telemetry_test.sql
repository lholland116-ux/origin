begin;

create extension if not exists pgtap with schema extensions;

select plan(65);

select has_table(
  'public',
  'ai_request_telemetry',
  'AI request telemetry table exists'
);

select has_pk(
  'public',
  'ai_request_telemetry',
  'AI request telemetry has a primary key'
);

select col_type_is(
  'public',
  'ai_request_telemetry',
  'id',
  'bigint',
  'AI request telemetry uses a bigint identity key'
);

select col_has_default(
  'public',
  'ai_request_telemetry',
  'occurred_at',
  'AI request telemetry timestamps are assigned by the database'
);

select has_column('public', 'ai_request_telemetry', 'route', 'telemetry records route');
select has_column('public', 'ai_request_telemetry', 'attempt_kind', 'telemetry records attempt kind');
select has_column('public', 'ai_request_telemetry', 'model', 'telemetry records model');
select has_column('public', 'ai_request_telemetry', 'reasoning_effort', 'telemetry records reasoning effort');
select has_column('public', 'ai_request_telemetry', 'plan', 'telemetry records plan');
select has_column('public', 'ai_request_telemetry', 'outcome', 'telemetry records outcome');
select has_column('public', 'ai_request_telemetry', 'latency_ms', 'telemetry records latency');
select has_column('public', 'ai_request_telemetry', 'had_image', 'telemetry records image presence');
select has_column('public', 'ai_request_telemetry', 'input_tokens', 'telemetry records input tokens');
select has_column('public', 'ai_request_telemetry', 'cached_input_tokens', 'telemetry records cached input tokens');
select has_column('public', 'ai_request_telemetry', 'output_tokens', 'telemetry records output tokens');
select has_column('public', 'ai_request_telemetry', 'reasoning_tokens', 'telemetry records reasoning tokens');
select has_column('public', 'ai_request_telemetry', 'total_tokens', 'telemetry records total tokens');
select has_column('public', 'ai_request_telemetry', 'web_search_calls', 'telemetry records chargeable Web Search calls');
select col_type_is('public', 'ai_request_telemetry', 'web_search_calls', 'integer', 'Web Search call counts use integers');
select col_has_default('public', 'ai_request_telemetry', 'web_search_calls', 'Web Search call counts default to zero');
select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_request_telemetry' and column_name = 'web_search_calls'),
  'NO',
  'Web Search call counts are not nullable'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ai_request_telemetry'::regclass
      and conname = 'ai_request_telemetry_web_search_calls_check'
      and pg_get_constraintdef(oid) ilike '%web_search_calls >= 0%'
  ),
  'Web Search call counts have a nonnegative constraint'
);

select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_request_telemetry' and column_name = 'input_tokens'),
  'YES',
  'input tokens are nullable'
);
select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_request_telemetry' and column_name = 'cached_input_tokens'),
  'YES',
  'cached input tokens are nullable'
);
select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_request_telemetry' and column_name = 'output_tokens'),
  'YES',
  'output tokens are nullable'
);
select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_request_telemetry' and column_name = 'reasoning_tokens'),
  'YES',
  'reasoning tokens are nullable'
);
select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_request_telemetry' and column_name = 'total_tokens'),
  'YES',
  'total tokens are nullable'
);

insert into public.ai_request_telemetry (
  route,
  attempt_kind,
  model,
  reasoning_effort,
  plan,
  outcome,
  latency_ms
)
select
  'standard',
  'primary',
  'gpt-5.6-luna',
  effort,
  'free',
  'success',
  0
from unnest(array['none', 'low', 'medium', 'high', 'xhigh', 'max']) as effort;

select is(
  (select count(*) from public.ai_request_telemetry),
  6::bigint,
  'all six frozen provider reasoning efforts are accepted'
);
select is(
  (select min(web_search_calls) from public.ai_request_telemetry),
  0,
  'omitted Web Search call counts default to zero'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.ai_request_telemetry'::regclass
      and conname = 'ai_request_telemetry_reasoning_effort_check'
      and pg_get_constraintdef(oid) ilike '%none%'
      and pg_get_constraintdef(oid) ilike '%low%'
      and pg_get_constraintdef(oid) ilike '%medium%'
      and pg_get_constraintdef(oid) ilike '%high%'
      and pg_get_constraintdef(oid) ilike '%xhigh%'
      and pg_get_constraintdef(oid) ilike '%max%'
      and pg_get_constraintdef(oid) not ilike '%minimal%'
  ),
  'reasoning effort domain is exactly the frozen Luna telemetry domain'
);

select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('invalid', 'primary', 'gpt-5.6-luna', 'medium', 'free', 'success', 1)$$,
  '23514', null, 'route check rejects unsupported routes'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'invalid', 'gpt-5.6-luna', 'medium', 'free', 'success', 1)$$,
  '23514', null, 'attempt kind check rejects unsupported attempts'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', 'gpt-5.6-luna', 'invalid', 'free', 'success', 1)$$,
  '23514', null, 'reasoning effort check rejects unsupported effort'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', 'gpt-5.6-luna', 'minimal', 'free', 'success', 1)$$,
  '23514', null, 'reasoning effort check rejects minimal'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', 'gpt-5.6-luna', 'medium', 'invalid', 'success', 1)$$,
  '23514', null, 'plan check rejects unsupported plans'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', 'gpt-5.6-luna', 'medium', 'free', 'invalid', 1)$$,
  '23514', null, 'outcome check rejects unsupported outcomes'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', ' ', 'medium', 'free', 'success', 1)$$,
  '23514', null, 'model check rejects empty model identifiers'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', repeat('m', 129), 'medium', 'free', 'success', 1)$$,
  '23514', null, 'model check rejects identifiers longer than 128 characters'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', 'gpt-5.6-luna', 'medium', 'free', 'success', -1)$$,
  '23514', null, 'latency check rejects negative values'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms, input_tokens) values ('standard', 'primary', 'gpt-5.6-luna', 'medium', 'free', 'success', 1, -1)$$,
  '23514', null, 'input token check rejects negative values'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms, cached_input_tokens) values ('standard', 'primary', 'gpt-5.6-luna', 'medium', 'free', 'success', 1, -1)$$,
  '23514', null, 'cached input token check rejects negative values'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms, output_tokens) values ('standard', 'primary', 'gpt-5.6-luna', 'medium', 'free', 'success', 1, -1)$$,
  '23514', null, 'output token check rejects negative values'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms, reasoning_tokens) values ('standard', 'primary', 'gpt-5.6-luna', 'medium', 'free', 'success', 1, -1)$$,
  '23514', null, 'reasoning token check rejects negative values'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms, total_tokens) values ('standard', 'primary', 'gpt-5.6-luna', 'medium', 'free', 'success', 1, -1)$$,
  '23514', null, 'total token check rejects negative values'
);
select throws_ok(
  $$insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms, web_search_calls) values ('web_search', 'primary', 'gpt-6-luna', 'medium', 'free', 'success', 1, -1)$$,
  '23514', null, 'Web Search call check rejects negative values'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.ai_request_telemetry'::regclass),
  'AI request telemetry has row-level security enabled'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_policy where polrelid = 'public.ai_request_telemetry'::regclass
  ),
  'AI request telemetry has no client access policies'
);

select table_privs_are('public', 'ai_request_telemetry', 'anon', array[]::text[], 'anonymous clients cannot select, insert, update, or delete telemetry');
select table_privs_are('public', 'ai_request_telemetry', 'authenticated', array[]::text[], 'authenticated clients cannot select, insert, update, or delete telemetry');
select table_privs_are('public', 'ai_request_telemetry', 'service_role', array['DELETE', 'INSERT', 'SELECT']::text[], 'service role can only select, insert, and delete telemetry');

select ok(
  not has_sequence_privilege(
    'anon',
    'public.ai_request_telemetry_id_seq',
    'USAGE'
  ),
  'anonymous clients cannot use the AI telemetry identity sequence'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'public.ai_request_telemetry_id_seq',
    'USAGE'
  ),
  'authenticated clients cannot use the AI telemetry identity sequence'
);

select ok(
  has_sequence_privilege(
    'service_role',
    'public.ai_request_telemetry_id_seq',
    'USAGE'
  ),
  'service role can use the AI telemetry identity sequence'
);

select throws_ok(
  $$set local role anon; select * from public.ai_request_telemetry$$,
  '42501', null, 'anon cannot select telemetry'
);
select throws_ok(
  $$set local role anon; insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', 'anon-test', 'medium', 'free', 'success', 1)$$,
  '42501', null, 'anon cannot insert telemetry'
);
select throws_ok(
  $$set local role anon; delete from public.ai_request_telemetry$$,
  '42501', null, 'anon cannot delete telemetry'
);
select throws_ok(
  $$set local role authenticated; select * from public.ai_request_telemetry$$,
  '42501', null, 'authenticated cannot select telemetry'
);
select throws_ok(
  $$set local role authenticated; insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', 'authenticated-test', 'medium', 'free', 'success', 1)$$,
  '42501', null, 'authenticated cannot insert telemetry'
);
select throws_ok(
  $$set local role authenticated; delete from public.ai_request_telemetry$$,
  '42501', null, 'authenticated cannot delete telemetry'
);
select lives_ok(
  $$set local role service_role; insert into public.ai_request_telemetry (route, attempt_kind, model, reasoning_effort, plan, outcome, latency_ms) values ('standard', 'primary', 'service-role-test', 'medium', 'free', 'success', 1)$$,
  'service role can insert telemetry'
);
select lives_ok(
  $$set local role service_role; select * from public.ai_request_telemetry where model = 'service-role-test'$$,
  'service role can select telemetry'
);
select lives_ok(
  $$set local role service_role; delete from public.ai_request_telemetry where model = 'service-role-test'$$,
  'service role can delete telemetry'
);

select has_index('public', 'ai_request_telemetry', 'ai_request_telemetry_occurred_at_idx', 'telemetry has a descending occurred-at index');
select has_index('public', 'ai_request_telemetry', 'ai_request_telemetry_route_effort_occurred_at_idx', 'telemetry has a route-effort-time index');

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_request_telemetry'
  ),
  array['id', 'occurred_at', 'route', 'attempt_kind', 'model', 'reasoning_effort', 'plan', 'outcome', 'latency_ms', 'had_image', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'total_tokens', 'web_search_calls']::text[],
  'telemetry table contains only the privacy-minimized contract columns'
);

select * from finish();
rollback;
