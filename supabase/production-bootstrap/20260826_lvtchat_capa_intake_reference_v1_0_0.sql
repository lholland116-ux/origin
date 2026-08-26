-- Controlled production bootstrap
-- LVTChat CAPA Intake Analysis Reference v1.0.0
--
-- Human-approved 2026-08-26.
-- Internal methodology only; not external regulatory authority.
-- This script is intentionally outside supabase/migrations because
-- it contains production-tenant governed data.

begin;

set constraints all deferred;

do $bootstrap$
declare
  v_now timestamptz := statement_timestamp();
  v_org uuid := 'f57db69b-8506-4ed2-a1f6-505b34e190a7'::uuid;
  v_user uuid := '0bc46f03-3dfa-4222-88cb-4dc914b0be43'::uuid;
begin
  -- ------------------------------------------------------------
  -- Fail-closed production tenant and approver assertions
  -- ------------------------------------------------------------

  if not exists (
    select 1
    from public.capa_organizations
    where organization_id = v_org
      and organization_name = 'LVTChat LLC'
      and status = 'active'
      and effective_at <= v_now
      and (superseded_at is null or superseded_at > v_now)
  ) then
    raise exception using
      errcode = '55000',
      message = 'Expected active LVTChat LLC CAPA organization was not found.';
  end if;

  if not exists (
    select 1
    from public.capa_organization_memberships m
    join public.capa_role_assignments a
      on a.organization_id = m.organization_id
     and a.membership_id = m.membership_id
     and a.user_id = m.user_id
    join public.capa_roles r
      on r.role_id = a.role_id
    where m.organization_id = v_org
      and m.user_id = v_user
      and m.status = 'active'
      and m.effective_at <= v_now
      and (m.expires_at is null or m.expires_at > v_now)
      and a.role_id = 'CAPA_OWNER'
      and a.scope_code = 'ORGANIZATION'
      and a.scope_resource_type is null
      and a.scope_resource_id is null
      and a.status = 'active'
      and a.effective_at <= v_now
      and (a.expires_at is null or a.expires_at > v_now)
      and r.status = 'active'
      and r.human_authority
      and 'capa.ai.intake.advise' = any(r.permissions)
  ) then
    raise exception using
      errcode = '55000',
      message = 'Expected active human CAPA_OWNER intake-advisory authority was not found.';
  end if;

  -- ------------------------------------------------------------
  -- Exact-once bootstrap protection
  -- ------------------------------------------------------------

  if exists (
    select 1
    from public.capa_knowledge_sources
    where source_id = '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid
  ) or exists (
    select 1
    from public.capa_knowledge_source_versions
    where source_version_id = '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid
       or (
         organization_id = v_org
         and content_fingerprint = 'ffc4cc513a9318482ed573129e687e5264bd010488d064aedccaba57b91e9dcd'
       )
  ) then
    raise exception using
      errcode = '55000',
      message = 'The controlled CAPA intake reference is already registered.';
  end if;

  if exists (
    select 1
    from public.capa_knowledge_collections
    where collection_id = 'df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid
  ) then
    raise exception using
      errcode = '55000',
      message = 'The controlled CAPA intake collection already exists.';
  end if;

  -- ------------------------------------------------------------
  -- Stable source identity
  -- ------------------------------------------------------------

  insert into public.capa_knowledge_sources (
    source_id,
    visibility,
    organization_id,
    current_source_version_id,
    owner_actor_type,
    owner_actor_id,
    owner_actor_version,
    record_version,
    created_at,
    created_by_actor_type,
    created_by_actor_id,
    created_by_actor_version,
    updated_at,
    updated_by_actor_type,
    updated_by_actor_id,
    updated_by_actor_version
  ) values (
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    'organization',
    v_org,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'human',
    v_user::text,
    null,
    1,
    v_now,
    'human',
    v_user::text,
    null,
    v_now,
    'human',
    v_user::text,
    null
  );

  -- ------------------------------------------------------------
  -- Human-approved current/effective immutable source version
  -- ------------------------------------------------------------

  insert into public.capa_knowledge_source_versions (
    source_version_id, source_id, organization_id, version_number,
    source_type, authority_class, title, issuer, publisher, jurisdiction,
    region, document_number, edition, language, translation_status, status,
    publication_date, effective_at, retirement_at,
    supersedes_source_version_id, superseded_by_source_version_id,
    applicability_tags, origin, canonical_locator, fingerprint_algorithm,
    content_fingerprint, rights, access_policy, onboarding_stage,
    processing_status, processing_version, quality_status, quality_notes,
    next_review_at, approved_at, approved_by_actor_type,
    approved_by_actor_id, approved_by_actor_version, activated_at,
    record_version, created_at, created_by_actor_type, created_by_actor_id,
    created_by_actor_version, updated_at, updated_by_actor_type,
    updated_by_actor_id, updated_by_actor_version
  ) values (
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    v_org,
    1,
    'SRC-06',
    'APPROVED_INTERNAL_REFERENCE',
    'LVTChat CAPA Intake Analysis Reference',
    'LVTChat LLC',
    'LVTChat LLC',
    'INTERNAL',
    null,
    'LVT-CAPA-INTAKE-REF-001',
    '1.0.0',
    'en',
    'ORIGINAL',
    'current_effective',
    (v_now at time zone 'UTC')::date,
    v_now,
    null,
    null,
    null,
    '["CAPA","CAPA_INTAKE","PROBLEM_DEFINITION","CONTAINMENT","INVESTIGATION"]'::jsonb,
    'CONTROLLED_REPOSITORY_BOOTSTRAP',
    'repository://docs/knowledge/lvtchat-capa-intake-analysis-reference-v1.0.0.txt',
    'sha256',
    'ffc4cc513a9318482ed573129e687e5264bd010488d064aedccaba57b91e9dcd',
    '{"rights_classification":"LVTCHAT_OWNED","retention_policy":"QUALITY_RECORD","legal_hold":false}'::jsonb,
    '{"policy_version":"knowledge-access-1.0.0","permitted_role_ids":["CAPA_OWNER","CAPA_CONTRIBUTOR"],"permitted_site_ids":[],"permitted_product_ids":[],"sensitivity":"ORGANIZATION_CONFIDENTIAL","export_permitted":false,"excerpt_permitted":true,"redistribution_permitted":false}'::jsonb,
    'active',
    'pass',
    'lvtchat-capa-intake-bootstrap-1.0.0',
    'pass',
    '["Human-approved internal reference; no external regulatory authority claimed."]'::jsonb,
    v_now + interval '1 year',
    v_now,
    'human',
    v_user::text,
    null,
    v_now,
    1,
    v_now,
    'human',
    v_user::text,
    null,
    v_now,
    'human',
    v_user::text,
    null
  );

  -- ------------------------------------------------------------
  -- Immutable original artifact metadata
  -- ------------------------------------------------------------

  insert into public.capa_knowledge_original_artifacts (
    artifact_id, source_version_id, organization_id, media_type,
    byte_length, storage_reference, fingerprint_algorithm,
    content_fingerprint, quarantined, malware_scan_status, created_at
  ) values (
    '5a2becd1-383c-539c-ae7d-738c67ecb0a9'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    'text/plain; charset=utf-8',
    4872,
    'repository://docs/knowledge/lvtchat-capa-intake-analysis-reference-v1.0.0.txt',
    'sha256',
    'ffc4cc513a9318482ed573129e687e5264bd010488d064aedccaba57b91e9dcd',
    true,
    'not_applicable_plain_text',
    v_now
  );

  -- ------------------------------------------------------------
  -- Controlled normalized derivative
  -- ------------------------------------------------------------

  insert into public.capa_knowledge_derivatives (
    derivative_id, source_version_id, source_artifact_id, organization_id,
    derivative_kind, engine, engine_version, content,
    fingerprint_algorithm, content_fingerprint, processing_status,
    limitations, created_at
  ) values (
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    '5a2becd1-383c-539c-ae7d-738c67ecb0a9'::uuid,
    v_org,
    'normalized_text',
    'lvtchat-controlled-text-normalizer',
    '1.0.0',
    'LVTChat CAPA Intake Analysis Reference
Version 1.0.0

Purpose

This controlled internal reference provides a structured method for assisting
human users during CAPA intake analysis. It is an advisory methodology and is
not a regulation, regulatory interpretation, governing procedure, or substitute
for qualified human judgment.

1. Problem Statement Development

A CAPA intake problem statement should describe the observed condition
objectively and distinguish known facts from assumptions.

Where available, identify:

- what was observed;
- the expected requirement, specification, procedure, or condition;
- the actual observed result;
- the magnitude or nature of the difference;
- when and where the condition was detected;
- affected product, process, equipment, material, software, supplier, or
  documentation;
- known quantity or extent;
- the source of the information.

Do not state a root cause during intake unless it has already been established
through controlled evidence.

2. Scope Assessment

Evaluate whether sufficient information exists to determine the apparent
extent of the issue.

Relevant scope dimensions may include:

- product, device, component, material, or part number;
- revision or configuration;
- lot, batch, serial number, or production quantity;
- manufacturing or processing dates;
- production line, machine, tool, fixture, cavity, equipment, or software;
- site or location;
- supplier or subcontractor involvement;
- operator, shift, or work group;
- related complaints, nonconformances, deviations, service records, or CAPAs;
- released, distributed, in-process, quarantined, or remaining inventory.

Unknown scope dimensions should be identified explicitly rather than inferred.

3. Missing Information

Identify information that is necessary to clarify the problem or establish
its extent but is not yet available.

Examples include:

- affected product or part identity;
- applicable specification or requirement;
- batch or lot identifiers;
- total quantity potentially affected;
- location and disposition of affected units;
- measurement or inspection method;
- measurement-system validity;
- equipment or process identifiers;
- relevant dates and time period;
- related records or prior occurrences.

Missing information should be presented as a gap requiring human follow-up.

4. Containment and Immediate Risk Questions

CAPA intake analysis may identify questions that should be considered by
qualified personnel when determining immediate containment or escalation.

Examples include:

- Could additional affected product remain in process, inventory, distribution,
  or the field?
- Should potentially affected material be identified, segregated, or placed on
  hold pending human evaluation?
- Could the condition affect safety, performance, quality, compliance, or
  intended use?
- Is there evidence of recurrence or broader process impact?
- Are additional inspections, record reviews, or other immediate checks needed
  to understand extent?
- Does the issue require escalation under applicable complaint, nonconformance,
  risk-management, regulatory-reporting, or field-action procedures?

The AI does not make containment, reportability, disposition, recall, or safety
decisions.

5. Investigation Questions

Intake analysis may propose questions to guide subsequent human investigation.

Examples include:

- What evidence demonstrates when the condition first occurred?
- Is the condition isolated or systemic?
- What changed before the event occurred?
- Were applicable procedures and specifications current and followed?
- Were equipment, tools, software, materials, and measurement systems in an
  appropriate controlled state?
- Are similar events present in historical quality data?
- What evidence is needed to distinguish possible causal explanations?
- Which records, personnel, samples, equipment, or process data should be
  reviewed?

Investigation questions are advisory prompts and are not conclusions about root
cause.

6. Facts, Assumptions, and Uncertainty

The analysis shall distinguish:

- facts supported by the controlled CAPA record or governed evidence;
- assumptions used only to frame possible questions;
- missing information;
- conflicting information;
- uncertainty and limitations.

Unsupported assumptions shall not be presented as established facts.

7. Human Authority

All AI intake-analysis output is advisory only.

The AI shall not:

- approve a CAPA;
- determine final scope;
- make final risk or containment decisions;
- determine regulatory reportability;
- determine root cause;
- modify controlled CAPA data;
- transition workflow state;
- replace required human review or approval.

Qualified human users remain responsible for evaluating the evidence,
accepting, revising, or rejecting AI suggestions, and making all controlled
quality and regulatory decisions.
',
    'sha256',
    'ffc4cc513a9318482ed573129e687e5264bd010488d064aedccaba57b91e9dcd',
    'pass',
    '[]'::jsonb,
    v_now
  );

  -- ------------------------------------------------------------
  -- Immutable section-level passages
  -- ------------------------------------------------------------

  insert into public.capa_knowledge_passages (
    passage_id, source_version_id, derivative_id, organization_id,
    sequence_number, segmentation_version, content, contextual_heading,
    locators, overlap_passage_ids, fingerprint_algorithm,
    content_fingerprint, quality_status, machine_interpretable, created_at
  ) values (
    'ed33d211-fc3d-5e50-a893-5f787e17de72'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    v_org,
    1,
    'lvtchat-capa-intake-segmentation-1.0.0',
    'Purpose

This controlled internal reference provides a structured method for assisting
human users during CAPA intake analysis. It is an advisory methodology and is
not a regulation, regulatory interpretation, governing procedure, or substitute
for qualified human judgment.',
    'Purpose',
    '[{"kind":"section","label":"Purpose"}]'::jsonb,
    array[]::uuid[],
    'sha256',
    '6274108806adda13ad93413f8332c238b50f95f3ed6f1184aef72349dee411fb',
    'pass',
    true,
    v_now
  );

  insert into public.capa_knowledge_passages (
    passage_id, source_version_id, derivative_id, organization_id,
    sequence_number, segmentation_version, content, contextual_heading,
    locators, overlap_passage_ids, fingerprint_algorithm,
    content_fingerprint, quality_status, machine_interpretable, created_at
  ) values (
    '757612b1-9829-5e0b-ad2d-04c6d53ad589'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    v_org,
    2,
    'lvtchat-capa-intake-segmentation-1.0.0',
    '1. Problem Statement Development

A CAPA intake problem statement should describe the observed condition
objectively and distinguish known facts from assumptions.

Where available, identify:

- what was observed;
- the expected requirement, specification, procedure, or condition;
- the actual observed result;
- the magnitude or nature of the difference;
- when and where the condition was detected;
- affected product, process, equipment, material, software, supplier, or
  documentation;
- known quantity or extent;
- the source of the information.

Do not state a root cause during intake unless it has already been established
through controlled evidence.',
    '1. Problem Statement Development',
    '[{"kind":"section","label":"1. Problem Statement Development"}]'::jsonb,
    array[]::uuid[],
    'sha256',
    '9978d25229391162733d4f1753c10f55d00bfffd42f154013f8e62c84dd741d2',
    'pass',
    true,
    v_now
  );

  insert into public.capa_knowledge_passages (
    passage_id, source_version_id, derivative_id, organization_id,
    sequence_number, segmentation_version, content, contextual_heading,
    locators, overlap_passage_ids, fingerprint_algorithm,
    content_fingerprint, quality_status, machine_interpretable, created_at
  ) values (
    '52f36e4c-fd08-5c29-9279-bcef3c7c7a95'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    v_org,
    3,
    'lvtchat-capa-intake-segmentation-1.0.0',
    '2. Scope Assessment

Evaluate whether sufficient information exists to determine the apparent
extent of the issue.

Relevant scope dimensions may include:

- product, device, component, material, or part number;
- revision or configuration;
- lot, batch, serial number, or production quantity;
- manufacturing or processing dates;
- production line, machine, tool, fixture, cavity, equipment, or software;
- site or location;
- supplier or subcontractor involvement;
- operator, shift, or work group;
- related complaints, nonconformances, deviations, service records, or CAPAs;
- released, distributed, in-process, quarantined, or remaining inventory.

Unknown scope dimensions should be identified explicitly rather than inferred.',
    '2. Scope Assessment',
    '[{"kind":"section","label":"2. Scope Assessment"}]'::jsonb,
    array[]::uuid[],
    'sha256',
    '6f4fbc5eade84b1f322448c94c643036faeda9d0ff8b48d2d9f1489dd0de53d0',
    'pass',
    true,
    v_now
  );

  insert into public.capa_knowledge_passages (
    passage_id, source_version_id, derivative_id, organization_id,
    sequence_number, segmentation_version, content, contextual_heading,
    locators, overlap_passage_ids, fingerprint_algorithm,
    content_fingerprint, quality_status, machine_interpretable, created_at
  ) values (
    '9d665144-f310-5acd-842f-16fc1f205c50'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    v_org,
    4,
    'lvtchat-capa-intake-segmentation-1.0.0',
    '3. Missing Information

Identify information that is necessary to clarify the problem or establish
its extent but is not yet available.

Examples include:

- affected product or part identity;
- applicable specification or requirement;
- batch or lot identifiers;
- total quantity potentially affected;
- location and disposition of affected units;
- measurement or inspection method;
- measurement-system validity;
- equipment or process identifiers;
- relevant dates and time period;
- related records or prior occurrences.

Missing information should be presented as a gap requiring human follow-up.',
    '3. Missing Information',
    '[{"kind":"section","label":"3. Missing Information"}]'::jsonb,
    array[]::uuid[],
    'sha256',
    'f721af10c2a47b0adfe2b3cd388138d533f5f658bca810d59e724c0e14bf8f8f',
    'pass',
    true,
    v_now
  );

  insert into public.capa_knowledge_passages (
    passage_id, source_version_id, derivative_id, organization_id,
    sequence_number, segmentation_version, content, contextual_heading,
    locators, overlap_passage_ids, fingerprint_algorithm,
    content_fingerprint, quality_status, machine_interpretable, created_at
  ) values (
    '60617dc5-4a96-5e47-8c78-3d54cde7423f'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    v_org,
    5,
    'lvtchat-capa-intake-segmentation-1.0.0',
    '4. Containment and Immediate Risk Questions

CAPA intake analysis may identify questions that should be considered by
qualified personnel when determining immediate containment or escalation.

Examples include:

- Could additional affected product remain in process, inventory, distribution,
  or the field?
- Should potentially affected material be identified, segregated, or placed on
  hold pending human evaluation?
- Could the condition affect safety, performance, quality, compliance, or
  intended use?
- Is there evidence of recurrence or broader process impact?
- Are additional inspections, record reviews, or other immediate checks needed
  to understand extent?
- Does the issue require escalation under applicable complaint, nonconformance,
  risk-management, regulatory-reporting, or field-action procedures?

The AI does not make containment, reportability, disposition, recall, or safety
decisions.',
    '4. Containment and Immediate Risk Questions',
    '[{"kind":"section","label":"4. Containment and Immediate Risk Questions"}]'::jsonb,
    array[]::uuid[],
    'sha256',
    'faba0f98250da503bd2030bbc2a95e784b9933d0859991f4ebe898d6bcdfbe1c',
    'pass',
    true,
    v_now
  );

  insert into public.capa_knowledge_passages (
    passage_id, source_version_id, derivative_id, organization_id,
    sequence_number, segmentation_version, content, contextual_heading,
    locators, overlap_passage_ids, fingerprint_algorithm,
    content_fingerprint, quality_status, machine_interpretable, created_at
  ) values (
    'aa2cbda4-ee4f-5854-8a01-e3fdbb21cb2a'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    v_org,
    6,
    'lvtchat-capa-intake-segmentation-1.0.0',
    '5. Investigation Questions

Intake analysis may propose questions to guide subsequent human investigation.

Examples include:

- What evidence demonstrates when the condition first occurred?
- Is the condition isolated or systemic?
- What changed before the event occurred?
- Were applicable procedures and specifications current and followed?
- Were equipment, tools, software, materials, and measurement systems in an
  appropriate controlled state?
- Are similar events present in historical quality data?
- What evidence is needed to distinguish possible causal explanations?
- Which records, personnel, samples, equipment, or process data should be
  reviewed?

Investigation questions are advisory prompts and are not conclusions about root
cause.',
    '5. Investigation Questions',
    '[{"kind":"section","label":"5. Investigation Questions"}]'::jsonb,
    array[]::uuid[],
    'sha256',
    '50df46bdb0540e05e2874dc6bb0e0f7715219725e132d12b3defb582e3029c47',
    'pass',
    true,
    v_now
  );

  insert into public.capa_knowledge_passages (
    passage_id, source_version_id, derivative_id, organization_id,
    sequence_number, segmentation_version, content, contextual_heading,
    locators, overlap_passage_ids, fingerprint_algorithm,
    content_fingerprint, quality_status, machine_interpretable, created_at
  ) values (
    'decb8316-b320-5742-9699-2bed5397c8d1'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    v_org,
    7,
    'lvtchat-capa-intake-segmentation-1.0.0',
    '6. Facts, Assumptions, and Uncertainty

The analysis shall distinguish:

- facts supported by the controlled CAPA record or governed evidence;
- assumptions used only to frame possible questions;
- missing information;
- conflicting information;
- uncertainty and limitations.

Unsupported assumptions shall not be presented as established facts.',
    '6. Facts, Assumptions, and Uncertainty',
    '[{"kind":"section","label":"6. Facts, Assumptions, and Uncertainty"}]'::jsonb,
    array[]::uuid[],
    'sha256',
    '9826b3074245ffddaef0fa30effdd41a9bb03f085b7f46f87707ef26d1e04fc9',
    'pass',
    true,
    v_now
  );

  insert into public.capa_knowledge_passages (
    passage_id, source_version_id, derivative_id, organization_id,
    sequence_number, segmentation_version, content, contextual_heading,
    locators, overlap_passage_ids, fingerprint_algorithm,
    content_fingerprint, quality_status, machine_interpretable, created_at
  ) values (
    'b0206fb0-9019-5c36-a081-754dabf74731'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    'e43e1b39-b318-5499-ab27-cfc6b2000697'::uuid,
    v_org,
    8,
    'lvtchat-capa-intake-segmentation-1.0.0',
    '7. Human Authority

All AI intake-analysis output is advisory only.

The AI shall not:

- approve a CAPA;
- determine final scope;
- make final risk or containment decisions;
- determine regulatory reportability;
- determine root cause;
- modify controlled CAPA data;
- transition workflow state;
- replace required human review or approval.

Qualified human users remain responsible for evaluating the evidence,
accepting, revising, or rejecting AI suggestions, and making all controlled
quality and regulatory decisions.',
    '7. Human Authority',
    '[{"kind":"section","label":"7. Human Authority"}]'::jsonb,
    array[]::uuid[],
    'sha256',
    '16581a8cd7490647f0e0864075b764a788be776870bf4cfe7ed0094f1d0453e8',
    'pass',
    true,
    v_now
  );

  -- ------------------------------------------------------------
  -- Immutable approved collection snapshot
  -- ------------------------------------------------------------

  insert into public.capa_knowledge_collections (
    collection_id, visibility, organization_id, owner_actor_type,
    owner_actor_id, owner_actor_version, current_collection_version_id,
    record_version, created_at, updated_at
  ) values (
    'df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid,
    'organization',
    v_org,
    'human',
    v_user::text,
    null,
    '5de217e9-baf3-5110-8319-ba616f29c71d'::uuid,
    1,
    v_now,
    v_now
  );

  insert into public.capa_knowledge_collection_versions (
    collection_version_id, collection_id, organization_id, version_number,
    purpose, audience, access_policy, effective_at, retired_at,
    approved_by, created_at
  ) values (
    '5de217e9-baf3-5110-8319-ba616f29c71d'::uuid,
    'df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid,
    v_org,
    1,
    'Governed evidence for advisory CAPA intake analysis; internal methodology only, not external regulatory authority.',
    '["CAPA_OWNER","CAPA_CONTRIBUTOR"]'::jsonb,
    '{"policy_version":"knowledge-access-1.0.0","permitted_role_ids":["CAPA_OWNER","CAPA_CONTRIBUTOR"],"permitted_site_ids":[],"permitted_product_ids":[],"sensitivity":"ORGANIZATION_CONFIDENTIAL","export_permitted":false,"excerpt_permitted":true,"redistribution_permitted":false}'::jsonb,
    v_now,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'actor_type', 'human',
        'actor_id', v_user::text
      )
    ),
    v_now
  );

  insert into public.capa_knowledge_collection_version_sources (
    collection_version_id, source_version_id, organization_id, added_at
  ) values (
    '5de217e9-baf3-5110-8319-ba616f29c71d'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    v_now
  );

  -- ------------------------------------------------------------
  -- Ready tenant-scoped lexical retrieval index
  -- ------------------------------------------------------------

  insert into public.capa_knowledge_retrieval_index_entries (
    passage_id, source_id, source_version_id, organization_id,
    approved_global, collection_ids, collection_version_ids,
    source_type, source_status, quality_status, effective_at,
    retirement_at, permitted_role_ids, permitted_site_ids,
    permitted_product_ids, jurisdictions, applicability_tags,
    machine_interpretable, normalized_text,
    normalized_text_fingerprint_algorithm,
    normalized_text_fingerprint, lexical_document, semantic_embedding,
    structured_metadata, index_version, status, indexed_at
  ) values (
    'ed33d211-fc3d-5e50-a893-5f787e17de72'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    false,
    array['df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid],
    array['5de217e9-baf3-5110-8319-ba616f29c71d'::uuid],
    'SRC-06',
    'current_effective',
    'pass',
    v_now,
    null,
    array['CAPA_OWNER','CAPA_CONTRIBUTOR']::text[],
    array[]::text[],
    array[]::text[],
    array['INTERNAL']::text[],
    array[
      'CAPA',
      'CAPA_INTAKE',
      'PROBLEM_DEFINITION',
      'CONTAINMENT',
      'INVESTIGATION'
    ]::text[],
    true,
    'Purpose

This controlled internal reference provides a structured method for assisting
human users during CAPA intake analysis. It is an advisory methodology and is
not a regulation, regulatory interpretation, governing procedure, or substitute
for qualified human judgment.',
    'sha256',
    '6274108806adda13ad93413f8332c238b50f95f3ed6f1184aef72349dee411fb',
    null,
    null,
    '{"source_title":"LVTChat CAPA Intake Analysis Reference","section":"Purpose","source_type":"SRC-06","authority_class":"APPROVED_INTERNAL_REFERENCE"}'::jsonb,
    'capa-knowledge-index-1.0.0',
    'ready',
    v_now
  );

  insert into public.capa_knowledge_retrieval_index_entries (
    passage_id, source_id, source_version_id, organization_id,
    approved_global, collection_ids, collection_version_ids,
    source_type, source_status, quality_status, effective_at,
    retirement_at, permitted_role_ids, permitted_site_ids,
    permitted_product_ids, jurisdictions, applicability_tags,
    machine_interpretable, normalized_text,
    normalized_text_fingerprint_algorithm,
    normalized_text_fingerprint, lexical_document, semantic_embedding,
    structured_metadata, index_version, status, indexed_at
  ) values (
    '757612b1-9829-5e0b-ad2d-04c6d53ad589'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    false,
    array['df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid],
    array['5de217e9-baf3-5110-8319-ba616f29c71d'::uuid],
    'SRC-06',
    'current_effective',
    'pass',
    v_now,
    null,
    array['CAPA_OWNER','CAPA_CONTRIBUTOR']::text[],
    array[]::text[],
    array[]::text[],
    array['INTERNAL']::text[],
    array[
      'CAPA',
      'CAPA_INTAKE',
      'PROBLEM_DEFINITION',
      'CONTAINMENT',
      'INVESTIGATION'
    ]::text[],
    true,
    '1. Problem Statement Development

A CAPA intake problem statement should describe the observed condition
objectively and distinguish known facts from assumptions.

Where available, identify:

- what was observed;
- the expected requirement, specification, procedure, or condition;
- the actual observed result;
- the magnitude or nature of the difference;
- when and where the condition was detected;
- affected product, process, equipment, material, software, supplier, or
  documentation;
- known quantity or extent;
- the source of the information.

Do not state a root cause during intake unless it has already been established
through controlled evidence.',
    'sha256',
    '9978d25229391162733d4f1753c10f55d00bfffd42f154013f8e62c84dd741d2',
    null,
    null,
    '{"source_title":"LVTChat CAPA Intake Analysis Reference","section":"1. Problem Statement Development","source_type":"SRC-06","authority_class":"APPROVED_INTERNAL_REFERENCE"}'::jsonb,
    'capa-knowledge-index-1.0.0',
    'ready',
    v_now
  );

  insert into public.capa_knowledge_retrieval_index_entries (
    passage_id, source_id, source_version_id, organization_id,
    approved_global, collection_ids, collection_version_ids,
    source_type, source_status, quality_status, effective_at,
    retirement_at, permitted_role_ids, permitted_site_ids,
    permitted_product_ids, jurisdictions, applicability_tags,
    machine_interpretable, normalized_text,
    normalized_text_fingerprint_algorithm,
    normalized_text_fingerprint, lexical_document, semantic_embedding,
    structured_metadata, index_version, status, indexed_at
  ) values (
    '52f36e4c-fd08-5c29-9279-bcef3c7c7a95'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    false,
    array['df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid],
    array['5de217e9-baf3-5110-8319-ba616f29c71d'::uuid],
    'SRC-06',
    'current_effective',
    'pass',
    v_now,
    null,
    array['CAPA_OWNER','CAPA_CONTRIBUTOR']::text[],
    array[]::text[],
    array[]::text[],
    array['INTERNAL']::text[],
    array[
      'CAPA',
      'CAPA_INTAKE',
      'PROBLEM_DEFINITION',
      'CONTAINMENT',
      'INVESTIGATION'
    ]::text[],
    true,
    '2. Scope Assessment

Evaluate whether sufficient information exists to determine the apparent
extent of the issue.

Relevant scope dimensions may include:

- product, device, component, material, or part number;
- revision or configuration;
- lot, batch, serial number, or production quantity;
- manufacturing or processing dates;
- production line, machine, tool, fixture, cavity, equipment, or software;
- site or location;
- supplier or subcontractor involvement;
- operator, shift, or work group;
- related complaints, nonconformances, deviations, service records, or CAPAs;
- released, distributed, in-process, quarantined, or remaining inventory.

Unknown scope dimensions should be identified explicitly rather than inferred.',
    'sha256',
    '6f4fbc5eade84b1f322448c94c643036faeda9d0ff8b48d2d9f1489dd0de53d0',
    null,
    null,
    '{"source_title":"LVTChat CAPA Intake Analysis Reference","section":"2. Scope Assessment","source_type":"SRC-06","authority_class":"APPROVED_INTERNAL_REFERENCE"}'::jsonb,
    'capa-knowledge-index-1.0.0',
    'ready',
    v_now
  );

  insert into public.capa_knowledge_retrieval_index_entries (
    passage_id, source_id, source_version_id, organization_id,
    approved_global, collection_ids, collection_version_ids,
    source_type, source_status, quality_status, effective_at,
    retirement_at, permitted_role_ids, permitted_site_ids,
    permitted_product_ids, jurisdictions, applicability_tags,
    machine_interpretable, normalized_text,
    normalized_text_fingerprint_algorithm,
    normalized_text_fingerprint, lexical_document, semantic_embedding,
    structured_metadata, index_version, status, indexed_at
  ) values (
    '9d665144-f310-5acd-842f-16fc1f205c50'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    false,
    array['df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid],
    array['5de217e9-baf3-5110-8319-ba616f29c71d'::uuid],
    'SRC-06',
    'current_effective',
    'pass',
    v_now,
    null,
    array['CAPA_OWNER','CAPA_CONTRIBUTOR']::text[],
    array[]::text[],
    array[]::text[],
    array['INTERNAL']::text[],
    array[
      'CAPA',
      'CAPA_INTAKE',
      'PROBLEM_DEFINITION',
      'CONTAINMENT',
      'INVESTIGATION'
    ]::text[],
    true,
    '3. Missing Information

Identify information that is necessary to clarify the problem or establish
its extent but is not yet available.

Examples include:

- affected product or part identity;
- applicable specification or requirement;
- batch or lot identifiers;
- total quantity potentially affected;
- location and disposition of affected units;
- measurement or inspection method;
- measurement-system validity;
- equipment or process identifiers;
- relevant dates and time period;
- related records or prior occurrences.

Missing information should be presented as a gap requiring human follow-up.',
    'sha256',
    'f721af10c2a47b0adfe2b3cd388138d533f5f658bca810d59e724c0e14bf8f8f',
    null,
    null,
    '{"source_title":"LVTChat CAPA Intake Analysis Reference","section":"3. Missing Information","source_type":"SRC-06","authority_class":"APPROVED_INTERNAL_REFERENCE"}'::jsonb,
    'capa-knowledge-index-1.0.0',
    'ready',
    v_now
  );

  insert into public.capa_knowledge_retrieval_index_entries (
    passage_id, source_id, source_version_id, organization_id,
    approved_global, collection_ids, collection_version_ids,
    source_type, source_status, quality_status, effective_at,
    retirement_at, permitted_role_ids, permitted_site_ids,
    permitted_product_ids, jurisdictions, applicability_tags,
    machine_interpretable, normalized_text,
    normalized_text_fingerprint_algorithm,
    normalized_text_fingerprint, lexical_document, semantic_embedding,
    structured_metadata, index_version, status, indexed_at
  ) values (
    '60617dc5-4a96-5e47-8c78-3d54cde7423f'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    false,
    array['df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid],
    array['5de217e9-baf3-5110-8319-ba616f29c71d'::uuid],
    'SRC-06',
    'current_effective',
    'pass',
    v_now,
    null,
    array['CAPA_OWNER','CAPA_CONTRIBUTOR']::text[],
    array[]::text[],
    array[]::text[],
    array['INTERNAL']::text[],
    array[
      'CAPA',
      'CAPA_INTAKE',
      'PROBLEM_DEFINITION',
      'CONTAINMENT',
      'INVESTIGATION'
    ]::text[],
    true,
    '4. Containment and Immediate Risk Questions

CAPA intake analysis may identify questions that should be considered by
qualified personnel when determining immediate containment or escalation.

Examples include:

- Could additional affected product remain in process, inventory, distribution,
  or the field?
- Should potentially affected material be identified, segregated, or placed on
  hold pending human evaluation?
- Could the condition affect safety, performance, quality, compliance, or
  intended use?
- Is there evidence of recurrence or broader process impact?
- Are additional inspections, record reviews, or other immediate checks needed
  to understand extent?
- Does the issue require escalation under applicable complaint, nonconformance,
  risk-management, regulatory-reporting, or field-action procedures?

The AI does not make containment, reportability, disposition, recall, or safety
decisions.',
    'sha256',
    'faba0f98250da503bd2030bbc2a95e784b9933d0859991f4ebe898d6bcdfbe1c',
    null,
    null,
    '{"source_title":"LVTChat CAPA Intake Analysis Reference","section":"4. Containment and Immediate Risk Questions","source_type":"SRC-06","authority_class":"APPROVED_INTERNAL_REFERENCE"}'::jsonb,
    'capa-knowledge-index-1.0.0',
    'ready',
    v_now
  );

  insert into public.capa_knowledge_retrieval_index_entries (
    passage_id, source_id, source_version_id, organization_id,
    approved_global, collection_ids, collection_version_ids,
    source_type, source_status, quality_status, effective_at,
    retirement_at, permitted_role_ids, permitted_site_ids,
    permitted_product_ids, jurisdictions, applicability_tags,
    machine_interpretable, normalized_text,
    normalized_text_fingerprint_algorithm,
    normalized_text_fingerprint, lexical_document, semantic_embedding,
    structured_metadata, index_version, status, indexed_at
  ) values (
    'aa2cbda4-ee4f-5854-8a01-e3fdbb21cb2a'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    false,
    array['df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid],
    array['5de217e9-baf3-5110-8319-ba616f29c71d'::uuid],
    'SRC-06',
    'current_effective',
    'pass',
    v_now,
    null,
    array['CAPA_OWNER','CAPA_CONTRIBUTOR']::text[],
    array[]::text[],
    array[]::text[],
    array['INTERNAL']::text[],
    array[
      'CAPA',
      'CAPA_INTAKE',
      'PROBLEM_DEFINITION',
      'CONTAINMENT',
      'INVESTIGATION'
    ]::text[],
    true,
    '5. Investigation Questions

Intake analysis may propose questions to guide subsequent human investigation.

Examples include:

- What evidence demonstrates when the condition first occurred?
- Is the condition isolated or systemic?
- What changed before the event occurred?
- Were applicable procedures and specifications current and followed?
- Were equipment, tools, software, materials, and measurement systems in an
  appropriate controlled state?
- Are similar events present in historical quality data?
- What evidence is needed to distinguish possible causal explanations?
- Which records, personnel, samples, equipment, or process data should be
  reviewed?

Investigation questions are advisory prompts and are not conclusions about root
cause.',
    'sha256',
    '50df46bdb0540e05e2874dc6bb0e0f7715219725e132d12b3defb582e3029c47',
    null,
    null,
    '{"source_title":"LVTChat CAPA Intake Analysis Reference","section":"5. Investigation Questions","source_type":"SRC-06","authority_class":"APPROVED_INTERNAL_REFERENCE"}'::jsonb,
    'capa-knowledge-index-1.0.0',
    'ready',
    v_now
  );

  insert into public.capa_knowledge_retrieval_index_entries (
    passage_id, source_id, source_version_id, organization_id,
    approved_global, collection_ids, collection_version_ids,
    source_type, source_status, quality_status, effective_at,
    retirement_at, permitted_role_ids, permitted_site_ids,
    permitted_product_ids, jurisdictions, applicability_tags,
    machine_interpretable, normalized_text,
    normalized_text_fingerprint_algorithm,
    normalized_text_fingerprint, lexical_document, semantic_embedding,
    structured_metadata, index_version, status, indexed_at
  ) values (
    'decb8316-b320-5742-9699-2bed5397c8d1'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    false,
    array['df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid],
    array['5de217e9-baf3-5110-8319-ba616f29c71d'::uuid],
    'SRC-06',
    'current_effective',
    'pass',
    v_now,
    null,
    array['CAPA_OWNER','CAPA_CONTRIBUTOR']::text[],
    array[]::text[],
    array[]::text[],
    array['INTERNAL']::text[],
    array[
      'CAPA',
      'CAPA_INTAKE',
      'PROBLEM_DEFINITION',
      'CONTAINMENT',
      'INVESTIGATION'
    ]::text[],
    true,
    '6. Facts, Assumptions, and Uncertainty

The analysis shall distinguish:

- facts supported by the controlled CAPA record or governed evidence;
- assumptions used only to frame possible questions;
- missing information;
- conflicting information;
- uncertainty and limitations.

Unsupported assumptions shall not be presented as established facts.',
    'sha256',
    '9826b3074245ffddaef0fa30effdd41a9bb03f085b7f46f87707ef26d1e04fc9',
    null,
    null,
    '{"source_title":"LVTChat CAPA Intake Analysis Reference","section":"6. Facts, Assumptions, and Uncertainty","source_type":"SRC-06","authority_class":"APPROVED_INTERNAL_REFERENCE"}'::jsonb,
    'capa-knowledge-index-1.0.0',
    'ready',
    v_now
  );

  insert into public.capa_knowledge_retrieval_index_entries (
    passage_id, source_id, source_version_id, organization_id,
    approved_global, collection_ids, collection_version_ids,
    source_type, source_status, quality_status, effective_at,
    retirement_at, permitted_role_ids, permitted_site_ids,
    permitted_product_ids, jurisdictions, applicability_tags,
    machine_interpretable, normalized_text,
    normalized_text_fingerprint_algorithm,
    normalized_text_fingerprint, lexical_document, semantic_embedding,
    structured_metadata, index_version, status, indexed_at
  ) values (
    'b0206fb0-9019-5c36-a081-754dabf74731'::uuid,
    '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid,
    '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid,
    v_org,
    false,
    array['df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid],
    array['5de217e9-baf3-5110-8319-ba616f29c71d'::uuid],
    'SRC-06',
    'current_effective',
    'pass',
    v_now,
    null,
    array['CAPA_OWNER','CAPA_CONTRIBUTOR']::text[],
    array[]::text[],
    array[]::text[],
    array['INTERNAL']::text[],
    array[
      'CAPA',
      'CAPA_INTAKE',
      'PROBLEM_DEFINITION',
      'CONTAINMENT',
      'INVESTIGATION'
    ]::text[],
    true,
    '7. Human Authority

All AI intake-analysis output is advisory only.

The AI shall not:

- approve a CAPA;
- determine final scope;
- make final risk or containment decisions;
- determine regulatory reportability;
- determine root cause;
- modify controlled CAPA data;
- transition workflow state;
- replace required human review or approval.

Qualified human users remain responsible for evaluating the evidence,
accepting, revising, or rejecting AI suggestions, and making all controlled
quality and regulatory decisions.',
    'sha256',
    '16581a8cd7490647f0e0864075b764a788be776870bf4cfe7ed0094f1d0453e8',
    null,
    null,
    '{"source_title":"LVTChat CAPA Intake Analysis Reference","section":"7. Human Authority","source_type":"SRC-06","authority_class":"APPROVED_INTERNAL_REFERENCE"}'::jsonb,
    'capa-knowledge-index-1.0.0',
    'ready',
    v_now
  );

  -- ------------------------------------------------------------
  -- Post-insert fail-closed integrity assertions
  -- ------------------------------------------------------------

  if (
    select count(*)
    from public.capa_knowledge_passages
    where source_version_id = '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid
  ) <> 8 then
    raise exception using
      errcode = '55000',
      message = 'Expected exactly eight governed CAPA intake passages.';
  end if;

  if (
    select count(*)
    from public.capa_knowledge_retrieval_index_entries
    where source_version_id = '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid
      and status = 'ready'
      and source_status = 'current_effective'
      and quality_status = 'pass'
      and organization_id = v_org
      and not approved_global
  ) <> 8 then
    raise exception using
      errcode = '55000',
      message = 'Expected exactly eight ready tenant-scoped retrieval entries.';
  end if;

  if exists (
    select 1
    from public.capa_knowledge_retrieval_index_entries i
    join public.capa_knowledge_passages p
      on p.passage_id = i.passage_id
     and p.source_version_id = i.source_version_id
    where i.source_version_id = '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid
      and (
        i.normalized_text <> p.content
        or i.normalized_text_fingerprint_algorithm <> p.fingerprint_algorithm
        or i.normalized_text_fingerprint <> p.content_fingerprint
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Retrieval index material does not match immutable passage material.';
  end if;

  if not exists (
    select 1
    from public.capa_knowledge_sources s
    join public.capa_knowledge_source_versions v
      on v.source_version_id = s.current_source_version_id
    where s.source_id = '145ff42d-4073-55cd-b8e0-e06973e3a088'::uuid
      and s.organization_id = v_org
      and v.status = 'current_effective'
      and v.onboarding_stage = 'active'
      and v.processing_status = 'pass'
      and v.quality_status = 'pass'
      and v.approved_by_actor_type = 'human'
      and v.approved_by_actor_id = v_user::text
  ) then
    raise exception using
      errcode = '55000',
      message = 'Final governed source lifecycle state is invalid.';
  end if;

  if not exists (
    select 1
    from public.capa_knowledge_collections c
    join public.capa_knowledge_collection_versions cv
      on cv.collection_version_id = c.current_collection_version_id
    join public.capa_knowledge_collection_version_sources cvs
      on cvs.collection_version_id = cv.collection_version_id
    where c.collection_id = 'df3e4e8a-65f8-5903-a690-940ae7b70ffd'::uuid
      and c.organization_id = v_org
      and cv.collection_version_id = '5de217e9-baf3-5110-8319-ba616f29c71d'::uuid
      and cvs.source_version_id = '929cbc36-1127-58b7-ae6f-4fb5dd1bb088'::uuid
  ) then
    raise exception using
      errcode = '55000',
      message = 'Final governed collection snapshot is invalid.';
  end if;
end;
$bootstrap$;

commit;
