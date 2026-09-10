begin;

alter table public.capa_action_plan_workspace_drafts
  add column action_plan_return_response jsonb;

alter table public.capa_action_plan_workspace_drafts
  add constraint capa_s60_workspace_action_plan_return_response_object
  check (
    action_plan_return_response is null or
    jsonb_typeof(action_plan_return_response) = 'object'
  );

commit;
