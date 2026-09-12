begin;

-- The original workspace guard required the immutable S70 approval decision to
-- result in the row's current case version.  That is correct for the first
-- S70 -> S80 entry, but not for a later S90 -> S80 return rollover.  Keep the
-- table, trigger, and all existing constraints unchanged; replace only the
-- trigger function with explicit insert, ordinary-update, and exact
-- return-rollover branches.
create or replace function private.capa_s80_implementation_workspace_baseline_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
begin
  if tg_op = 'UPDATE' and (
    old.organization_id <> new.organization_id
    or old.capa_case_id <> new.capa_case_id
    or old.workflow_state <> 'S80'
    or new.workflow_state <> 'S80'
    or old.source_case_version_id <> new.source_case_version_id
    or old.approved_action_plan_section_id <> new.approved_action_plan_section_id
    or old.approval_decision_reference <> new.approval_decision_reference
  ) then
    raise exception using
      errcode = '23514',
      message = 'S80 implementation workspace identity or approved baseline is immutable.';
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
    join public.capa_section_versions as action_section
      on action_section.organization_id = source_section.organization_id
     and action_section.capa_case_id = source_section.capa_case_id
     and action_section.section_version_id = source_section.section_version_id
     and action_section.section_type = 'CAPA.ACTION_PLAN'
     and action_section.schema_version = 'capa-action-plan-1.0.0'
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
    join public.capa_audit_events as approval_audit
      on approval_audit.organization_id = decision.organization_id
     and approval_audit.event_id = decision.transition_audit_event_id
    where decision.organization_id = new.organization_id
      and decision.capa_case_id = new.capa_case_id
      and decision.source_case_version_id = new.source_case_version_id
      and decision.action_plan_section_version_id = new.approved_action_plan_section_id
      and decision.transition_audit_event_id = new.approval_decision_reference
      and decision.decision = 'approve'
      and approval_audit.event_type = 'EVT-STATE-TRANSITION'
      and approval_audit.aggregate_type = 'CAPA_CASE'
      and approval_audit.aggregate_id = new.capa_case_id::text
      and approval_audit.outcome = 'succeeded'
  ) then
    raise exception using
      errcode = '23514',
      message = 'S80 implementation workspace baseline must reference an approved S70 action-plan decision.';
  end if;

  if tg_op = 'INSERT' then
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
        message = 'Original S80 implementation workspace must bind the approved S70 decision result.';
    end if;
    return new;
  end if;

  if old.case_version_id = new.case_version_id then
    return new;
  end if;

  if old.case_version_id <> new.case_version_id then
    if not exists (
      select 1
      from public.capa_case_versions as old_s80
      join public.capa_case_versions as source_s90
        on source_s90.organization_id = old_s80.organization_id
       and source_s90.capa_case_id = old_s80.capa_case_id
       and source_s90.parent_version_id = old_s80.case_version_id
       and source_s90.version_number = old_s80.version_number + 1
       and source_s90.status = 'S90'
      join public.capa_case_versions as new_s80
        on new_s80.organization_id = source_s90.organization_id
       and new_s80.capa_case_id = source_s90.capa_case_id
       and new_s80.case_version_id = new.case_version_id
       and new_s80.parent_version_id = source_s90.case_version_id
       and new_s80.version_number = source_s90.version_number + 1
       and new_s80.version_number = new.record_version
       and new_s80.status = 'S80'
      join public.capa_implementation_review_decisions as review_decision
        on review_decision.organization_id = source_s90.organization_id
       and review_decision.capa_case_id = source_s90.capa_case_id
       and review_decision.source_case_version_id = source_s90.case_version_id
       and review_decision.resulting_case_version_id = new_s80.case_version_id
       and review_decision.decision = 'return'
      join public.capa_audit_events as review_audit
        on review_audit.organization_id = review_decision.organization_id
       and review_audit.event_id = review_decision.transition_audit_event_id
       and review_audit.event_type = 'EVT-STATE-TRANSITION'
       and review_audit.aggregate_type = 'CAPA_CASE'
       and review_audit.aggregate_id = new_s80.capa_case_id::text
       and review_audit.actor_type = 'human'
       and review_audit.actor_id = review_decision.reviewer_user_id::text
       and review_audit.outcome = 'succeeded'
       and review_audit.action = 'DECIDE_CAPA_IMPLEMENTATION_REVIEW'
       and review_audit.target_object_type = 'CAPA_CASE'
       and review_audit.target_object_id = new_s80.capa_case_id::text
       and review_audit.target_object_version_id = new_s80.case_version_id::text
       and review_audit.aggregate_version = new_s80.version_number
       and review_audit.occurred_at = review_decision.decided_at
       and review_audit.metadata ->> 'from_state' = 'S90'
       and review_audit.metadata ->> 'to_state' = 'S80'
       and review_audit.metadata ->> 'transition_event' = 'Return for implementation'
       and review_audit.metadata ->> 'source_case_version_id' = source_s90.case_version_id::text
       and review_audit.metadata ->> 'resulting_case_version_id' = new_s80.case_version_id::text
       and review_audit.metadata ->> 'review_decision' = 'return'
       and review_audit.metadata ->> 'implementation_review_baseline_section_version_id' = review_decision.implementation_review_baseline_section_version_id::text
      join public.capa_case_version_sections as reviewed_baseline_link
        on reviewed_baseline_link.organization_id = source_s90.organization_id
       and reviewed_baseline_link.capa_case_id = source_s90.capa_case_id
       and reviewed_baseline_link.case_version_id = source_s90.case_version_id
       and reviewed_baseline_link.section_version_id = review_decision.implementation_review_baseline_section_version_id
      join public.capa_section_versions as reviewed_baseline
        on reviewed_baseline.organization_id = reviewed_baseline_link.organization_id
       and reviewed_baseline.capa_case_id = reviewed_baseline_link.capa_case_id
       and reviewed_baseline.section_version_id = reviewed_baseline_link.section_version_id
       and reviewed_baseline.section_type = 'CAPA.IMPLEMENTATION_REVIEW_BASELINE'
       and reviewed_baseline.schema_version = 'capa-implementation-review-baseline-1.0.0'
       and reviewed_baseline.content -> 'approved_s70_baseline' ->> 'source_case_version_id' = new.source_case_version_id::text
       and reviewed_baseline.content -> 'approved_s70_baseline' ->> 'approved_action_plan_section_id' = new.approved_action_plan_section_id::text
       and reviewed_baseline.content -> 'approved_s70_baseline' ->> 'approval_decision_reference' = new.approval_decision_reference::text
       and reviewed_baseline.content ->> 'source_s80_case_version_id' = old_s80.case_version_id::text
       and reviewed_baseline.content ->> 'resulting_s90_case_version_id' = source_s90.case_version_id::text
      where old_s80.organization_id = new.organization_id
        and old_s80.capa_case_id = new.capa_case_id
        and old_s80.case_version_id = old.case_version_id
        and old_s80.version_number = old.record_version
        and old_s80.status = 'S80'
    ) then
      raise exception using
        errcode = '23514',
        message = 'S80 implementation workspace rollover must bind one exact S80 to S90 return cycle.';
    end if;
    return new;
  end if;

  raise exception using
    errcode = '23514',
    message = 'Unsupported S80 implementation workspace trigger operation.';
end;
$function$;

commit;
