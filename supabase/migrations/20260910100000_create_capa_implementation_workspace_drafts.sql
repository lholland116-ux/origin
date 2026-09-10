begin;

-- Current, mutable S80 implementation workspace only. Approved S70 action
-- content remains in the immutable section-version tables.
create table public.capa_implementation_workspace_drafts (
  organization_id uuid not null,
  capa_case_id uuid not null,
  case_version_id uuid not null,
  record_version bigint not null,
  workflow_state text not null default 'S80',
  source_case_version_id uuid not null,
  approved_action_plan_section_id uuid not null,
  approval_decision_reference uuid not null,
  draft_revision bigint not null,
  schema_version text not null,
  workspace_draft jsonb not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_by_user_id uuid not null,
  updated_at timestamptz not null default statement_timestamp(),

  constraint capa_s80_implementation_workspace_pkey
    primary key (organization_id, capa_case_id),
  constraint capa_s80_implementation_workspace_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_case_fk
    foreign key (organization_id, capa_case_id)
    references public.capa_cases (organization_id, capa_case_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_case_version_fk
    foreign key (organization_id, capa_case_id, case_version_id)
    references public.capa_case_versions
      (organization_id, capa_case_id, case_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_source_version_fk
    foreign key (organization_id, capa_case_id, source_case_version_id)
    references public.capa_case_versions
      (organization_id, capa_case_id, case_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_action_section_fk
    foreign key (organization_id, capa_case_id, approved_action_plan_section_id)
    references public.capa_section_versions
      (organization_id, capa_case_id, section_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_approval_decision_fk
    foreign key (organization_id, approval_decision_reference)
    references public.capa_audit_events (organization_id, event_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_source_decision_fk
    foreign key (organization_id, capa_case_id, source_case_version_id)
    references public.capa_action_plan_review_decisions
      (organization_id, capa_case_id, source_case_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_created_by_fk
    foreign key (organization_id, created_by_user_id)
    references public.capa_organization_memberships (organization_id, user_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_updated_by_fk
    foreign key (organization_id, updated_by_user_id)
    references public.capa_organization_memberships (organization_id, user_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_s80_implementation_workspace_record_version_safe_integer
    check (record_version >= 1 and record_version <= 9007199254740991),
  constraint capa_s80_implementation_workspace_revision_safe_integer
    check (draft_revision >= 1 and draft_revision <= 9007199254740991),
  constraint capa_s80_implementation_workspace_state
    check (workflow_state = 'S80'),
  constraint capa_s80_implementation_workspace_schema
    check (schema_version = 'capa-implementation-workspace-draft-1.0.0'),
  constraint capa_s80_implementation_workspace_draft_object
    check (jsonb_typeof(workspace_draft) = 'object'),
  constraint capa_s80_implementation_workspace_times
    check (updated_at >= created_at)
);

create or replace function private.capa_s80_implementation_workspace_baseline_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
begin
  if tg_op = 'UPDATE' and (
    old.source_case_version_id <> new.source_case_version_id
    or old.approved_action_plan_section_id <> new.approved_action_plan_section_id
    or old.approval_decision_reference <> new.approval_decision_reference
  ) then
    raise exception using
      errcode = '23514',
      message = 'S80 implementation workspace approved baseline is immutable.';
  end if;

  if not exists (
    select 1
    from public.capa_cases as capa_case
    join public.capa_case_versions as current_version
      on current_version.organization_id = capa_case.organization_id
     and current_version.capa_case_id = capa_case.capa_case_id
     and current_version.case_version_id = capa_case.current_version_id
     and current_version.version_number = capa_case.record_version
     and current_version.status = 'S80'
    where capa_case.organization_id = new.organization_id
      and capa_case.capa_case_id = new.capa_case_id
      and capa_case.current_version_id = new.case_version_id
      and capa_case.record_version = new.record_version
      and capa_case.status = 'S80'
  ) then
    raise exception using
      errcode = '23514',
      message = 'S80 implementation workspace must bind to the current S80 case version.';
  end if;

  if not exists (
    select 1
    from public.capa_case_versions as source_version
    join public.capa_case_version_sections as source_section
      on source_section.organization_id = source_version.organization_id
     and source_section.capa_case_id = source_version.capa_case_id
     and source_section.case_version_id = source_version.case_version_id
     and source_section.section_version_id = new.approved_action_plan_section_id
    where source_version.organization_id = new.organization_id
      and source_version.capa_case_id = new.capa_case_id
      and source_version.case_version_id = new.source_case_version_id
      and source_version.status = 'S70'
  ) then
    raise exception using
      errcode = '23514',
      message = 'S80 implementation workspace baseline must reference an S70 action-plan section.';
  end if;

  if not exists (
    select 1
    from public.capa_action_plan_review_decisions as decision
    where decision.organization_id = new.organization_id
      and decision.capa_case_id = new.capa_case_id
      and decision.source_case_version_id = new.source_case_version_id
      and decision.action_plan_section_version_id = new.approved_action_plan_section_id
      and decision.transition_audit_event_id = new.approval_decision_reference
      and decision.resulting_case_version_id = new.case_version_id
      and decision.decision = 'approve'
  ) then
    raise exception using
      errcode = '23514',
      message = 'S80 implementation workspace baseline must reference an approved S70 action-plan decision.';
  end if;

  return new;
end;
$function$;

create trigger capa_s80_implementation_workspace_baseline_guard
before insert or update
on public.capa_implementation_workspace_drafts
for each row
execute function private.capa_s80_implementation_workspace_baseline_guard();

alter table public.capa_implementation_workspace_drafts enable row level security;
alter table public.capa_implementation_workspace_drafts force row level security;

revoke all
on table public.capa_implementation_workspace_drafts
from public, anon, authenticated, service_role;
grant select, insert, update
on table public.capa_implementation_workspace_drafts
to service_role;

comment on table public.capa_implementation_workspace_drafts is
  'Current non-authoritative S80 implementation workspace snapshot, transactionally bound to one approved immutable S70 action-plan baseline.';

comment on column public.capa_implementation_workspace_drafts.workspace_draft is
  'Mutable capa-implementation-workspace-draft-1.0.0 content; authoritative S70 action fields are not copied here.';

comment on column public.capa_implementation_workspace_drafts.approval_decision_reference is
  'Exact immutable S70 approval transition audit-event reference for the bound baseline.';

commit;
