begin;

alter table public.capa_investigation_active_workspace_drafts
  add column root_cause_return_response jsonb;

alter table public.capa_investigation_active_workspace_drafts
  add constraint capa_s40_workspace_root_cause_return_response_object
  check (
    root_cause_return_response is null or
    jsonb_typeof(root_cause_return_response) = 'object'
  );

commit;
