begin;

-- Analytical-use approval is deliberately separate from the immutable
-- Layer 1 review_state and from source/evidence verification.
do $$
begin
  if not exists (
    select 1 from public.capa_roles
    where role_id = 'CAPA_ORG_ADMIN'
      and status = 'active'
      and human_authority
  ) then
    raise exception 'QUALITY_DATA_ADMIN_ROLE_MISSING';
  end if;

  if exists (
    select 1 from public.capa_roles
    where role_id <> 'CAPA_ORG_ADMIN'
      and 'quality_data.version.approve' = any(permissions)
  ) then
    raise exception 'QUALITY_DATA_APPROVAL_PERMISSION_ROLE_CONFLICT';
  end if;
end
$$;

update public.capa_roles
set permissions = case
      when 'quality_data.version.approve' = any(permissions)
        then permissions
      else array_append(permissions, 'quality_data.version.approve')
    end,
    role_version = '1.3.0'
where role_id = 'CAPA_ORG_ADMIN';

alter table public.quality_data_dataset_versions
  add constraint quality_data_dataset_versions_approval_binding
  unique (organization_id, dataset_id, dataset_version_id);

create table public.quality_data_dataset_version_approval_events (
  approval_event_id uuid primary key,
  organization_id uuid not null,
  dataset_id uuid not null,
  dataset_version_id uuid not null,
  transition_number integer not null,
  decision text not null,
  reviewer_user_id uuid not null,
  reviewer_membership_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  rationale text not null,
  previous_event_id uuid,
  request_id uuid not null,
  correlation_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  unique (organization_id, dataset_id, dataset_version_id, transition_number),
  unique (organization_id, dataset_id, dataset_version_id, approval_event_id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, dataset_id, dataset_version_id)
    references public.quality_data_dataset_versions
      (organization_id, dataset_id, dataset_version_id)
    on update restrict on delete restrict,
  foreign key (organization_id, reviewer_user_id, reviewer_membership_id)
    references public.capa_organization_memberships
      (organization_id, user_id, membership_id)
    on update restrict on delete restrict,
  foreign key (organization_id, dataset_id, dataset_version_id, previous_event_id)
    references public.quality_data_dataset_version_approval_events
      (organization_id, dataset_id, dataset_version_id, approval_event_id)
    on update restrict on delete restrict,
  constraint quality_data_approval_transition_number
    check (transition_number > 0),
  constraint quality_data_approval_decision
    check (decision in ('approved', 'rejected', 'revoked')),
  constraint quality_data_approval_rationale
    check (char_length(btrim(rationale)) between 1 and 1000),
  constraint quality_data_approval_idempotency_key
    check (char_length(btrim(idempotency_key)) between 1 and 200),
  constraint quality_data_approval_fingerprint
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint quality_data_approval_previous_event
    check ((transition_number = 1 and previous_event_id is null)
      or (transition_number > 1 and previous_event_id is not null))
);

create index quality_data_approval_latest_idx
  on public.quality_data_dataset_version_approval_events
    (organization_id, dataset_id, dataset_version_id, transition_number desc);

create trigger quality_data_approval_events_immutable
before update or delete on public.quality_data_dataset_version_approval_events
for each row execute function private.quality_data_reject_immutable_mutation();

alter table public.quality_data_dataset_version_approval_events enable row level security;
alter table public.quality_data_dataset_version_approval_events force row level security;
create policy quality_data_approval_events_admin_read
  on public.quality_data_dataset_version_approval_events
  for select to authenticated
  using (private.quality_data_can_read(organization_id));
revoke all on public.quality_data_dataset_version_approval_events
  from public, anon, authenticated, service_role;
grant select on public.quality_data_dataset_version_approval_events to authenticated;
grant select, insert on public.quality_data_dataset_version_approval_events to service_role;

-- Extend the existing shared, database-backed limiter for the two new
-- quality-data operations. The ingestion actions and limits are unchanged.
alter table public.quality_data_xlsx_api_rate_windows
  drop constraint if exists quality_data_xlsx_api_rate_windows_action_check;
alter table public.quality_data_xlsx_api_rate_windows
  add constraint quality_data_xlsx_api_rate_windows_action_check
  check (action in ('inspect', 'preview', 'ingest', 'analysis', 'approval'));

create or replace function public.consume_quality_data_xlsx_api_rate_limit(
  p_user_id uuid,
  p_action text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_limit integer;
  v_now timestamptz;
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_user_id is null or p_action is null
    or p_action not in ('inspect', 'preview', 'ingest', 'analysis', 'approval') then
    raise exception using errcode = '22023', message = 'INVALID_QUALITY_DATA_RATE_LIMIT_REQUEST';
  end if;

  v_limit := case p_action when 'ingest' then 5 else 12 end;
  v_now := pg_catalog.clock_timestamp();
  v_window_started_at := v_now;

  insert into public.quality_data_xlsx_api_rate_windows as rate_window (
    user_id, action, window_started_at, request_count
  ) values (p_user_id, p_action, v_window_started_at, 1)
  on conflict (user_id, action) do update
    set window_started_at = case
          when rate_window.window_started_at + interval '10 minutes' <= v_now then v_now
          else rate_window.window_started_at
        end,
        request_count = case
          when rate_window.window_started_at + interval '10 minutes' <= v_now then 1
          else rate_window.request_count + 1
        end
    where rate_window.window_started_at + interval '10 minutes' <= v_now
       or rate_window.request_count < v_limit
  returning request_count into v_request_count;

  return v_request_count is not null;
end;
$function$;

revoke all on function public.consume_quality_data_xlsx_api_rate_limit(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_quality_data_xlsx_api_rate_limit(uuid, text)
  to service_role;

comment on table public.quality_data_dataset_version_approval_events is
  'Append-only analytical-use approval history. Approval does not verify source evidence or authorize CAPA decisions.';

commit;
