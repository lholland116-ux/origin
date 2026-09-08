begin;

create table public.capa_action_plan_workspace_drafts (
  organization_id uuid not null references public.capa_organizations (organization_id) on update restrict on delete restrict,
  capa_case_id uuid not null,
  case_version_id uuid not null,
  record_version bigint not null constraint capa_s60_workspace_record_version_safe_integer check (record_version >= 1 and record_version <= 9007199254740991),
  draft_revision bigint not null constraint capa_s60_workspace_draft_revision_safe_integer check (draft_revision >= 1 and draft_revision <= 9007199254740991),
  schema_version text not null constraint capa_s60_workspace_schema_version check (schema_version = 'capa-action-plan-workspace-draft-1.0.0'),
  trust text not null constraint capa_s60_workspace_trust check (trust = 'untrusted_human_draft'),
  workflow_state text not null constraint capa_s60_workspace_workflow_state check (workflow_state = 'S60'),
  action_plan jsonb not null constraint capa_s60_workspace_action_plan_object check (jsonb_typeof(action_plan) = 'object'),
  updated_by_user_id uuid not null,
  updated_at timestamptz not null,
  primary key (organization_id, capa_case_id)
);

alter table public.capa_action_plan_workspace_drafts enable row level security;
alter table public.capa_action_plan_workspace_drafts force row level security;
revoke all on table public.capa_action_plan_workspace_drafts from public, anon, authenticated, service_role;
grant select, insert, update on table public.capa_action_plan_workspace_drafts to service_role;
comment on table public.capa_action_plan_workspace_drafts is 'Current non-authoritative S60 Action Planning human workspace snapshot; never authoritative CAPA content.';

commit;
