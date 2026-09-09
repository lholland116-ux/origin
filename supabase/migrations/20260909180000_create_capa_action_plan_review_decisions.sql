begin;

-- ---------------------------------------------------------------------------
-- Immutable human S70 action-plan review decisions
-- ---------------------------------------------------------------------------
--
-- One decision is durable evidence for one exact submitted S70 baseline.
-- Workflow transition and audit-event creation remain application concerns;
-- this table only persists the committed decision binding.

create table public.capa_action_plan_review_decisions (
  organization_id uuid not null,
  capa_case_id uuid not null,
  source_case_version_id uuid not null,
  action_plan_section_version_id uuid not null,
  schema_version text not null,
  decision text not null,
  rationale text not null,
  reviewer_user_id uuid not null,
  decided_at timestamptz not null,
  resulting_case_version_id uuid not null,
  transition_audit_event_id uuid not null,

  constraint capa_action_plan_review_decisions_pkey
    primary key (
      organization_id,
      capa_case_id,
      source_case_version_id
    ),

  constraint capa_action_plan_review_decisions_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict
    deferrable initially deferred,

  constraint capa_action_plan_review_decisions_case_fk
    foreign key (organization_id, capa_case_id)
    references public.capa_cases (organization_id, capa_case_id)
    on update restrict on delete restrict
    deferrable initially deferred,

  constraint capa_action_plan_review_decisions_source_version_fk
    foreign key (organization_id, capa_case_id, source_case_version_id)
    references public.capa_case_versions
      (organization_id, capa_case_id, case_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,

  constraint capa_action_plan_review_decisions_action_plan_section_fk
    foreign key (organization_id, capa_case_id, action_plan_section_version_id)
    references public.capa_section_versions
      (organization_id, capa_case_id, section_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,

  constraint capa_action_plan_review_decisions_reviewer_fk
    foreign key (organization_id, reviewer_user_id)
    references public.capa_organization_memberships
      (organization_id, user_id)
    on update restrict on delete restrict
    deferrable initially deferred,

  constraint capa_action_plan_review_decisions_resulting_version_fk
    foreign key (organization_id, capa_case_id, resulting_case_version_id)
    references public.capa_case_versions
      (organization_id, capa_case_id, case_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,

  constraint capa_action_plan_review_decisions_audit_event_fk
    foreign key (organization_id, transition_audit_event_id)
    references public.capa_audit_events
      (organization_id, event_id)
    on update restrict on delete restrict
    deferrable initially deferred,

  constraint capa_action_plan_review_decisions_audit_event_unique
    unique (organization_id, transition_audit_event_id),

  constraint capa_action_plan_review_decisions_schema_version
    check (schema_version = 'capa-action-plan-review-decision-1.0.0'),

  constraint capa_action_plan_review_decisions_decision
    check (decision in ('approve', 'return')),

  constraint capa_action_plan_review_decisions_rationale
    check (
      rationale = btrim(rationale)
      and char_length(rationale) between 1 and 4000
    ),

  constraint capa_action_plan_review_decisions_distinct_versions
    check (source_case_version_id <> resulting_case_version_id)
);

create trigger capa_action_plan_review_decisions_reject_mutation
before update or delete
on public.capa_action_plan_review_decisions
for each row
execute function private.capa_reject_immutable_mutation();

alter table public.capa_action_plan_review_decisions
  enable row level security;
alter table public.capa_action_plan_review_decisions
  force row level security;

revoke all
on table public.capa_action_plan_review_decisions
from public, anon, authenticated, service_role;

grant select, insert
on table public.capa_action_plan_review_decisions
to service_role;

comment on table public.capa_action_plan_review_decisions is
  'Immutable server-only human S70 action-plan review decisions bound to one exact submitted action-plan baseline.';

comment on column public.capa_action_plan_review_decisions.source_case_version_id is
  'Exact immutable S70 case version reviewed by the human.';

comment on column public.capa_action_plan_review_decisions.action_plan_section_version_id is
  'Exact immutable CAPA.ACTION_PLAN section reviewed by the human.';

comment on column public.capa_action_plan_review_decisions.resulting_case_version_id is
  'Exact immutable case version created by the later controlled decision transition.';

comment on column public.capa_action_plan_review_decisions.transition_audit_event_id is
  'Exact audit event identity for the later controlled decision transition.';

commit;
