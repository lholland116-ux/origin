BEGIN;

-- A handoff is a distinct human decision from Stage 3D triage. The row is
-- first recorded as pending, then linked to the normal S00 CAPA draft in
-- the same database transaction. A deferred guard prevents pending intent
-- from ever committing without its CAPA and both audit references.
CREATE TABLE public.quality_data_intelligence_capa_handoffs (
  handoff_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  report_id uuid NOT NULL,
  dataset_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  approval_event_id uuid NOT NULL,
  intelligence_schema_version text NOT NULL,
  analysis_request_schema_version text NOT NULL,
  analysis_result_schema_version text NOT NULL,
  evidence_packet_version text NOT NULL,
  dataset_schema_version text NOT NULL,
  result_fingerprint text NOT NULL,
  finding_key text NOT NULL,
  finding_classification text NOT NULL,
  finding_fingerprint text NOT NULL,
  finding_snapshot jsonb NOT NULL,
  evidence_references jsonb NOT NULL,
  source_verification text NOT NULL DEFAULT 'not_asserted',
  interpretation_status text NOT NULL,
  decision text NOT NULL,
  decision_rationale text NOT NULL,
  reviewer_user_id uuid NOT NULL,
  reviewer_membership_id uuid NOT NULL,
  decided_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  handoff_status text NOT NULL DEFAULT 'pending',
  capa_case_id uuid,
  capa_case_status text,
  capa_case_version_id uuid,
  capa_section_version_id uuid,
  capa_creation_audit_event_id uuid,
  handoff_audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, handoff_id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, report_id, finding_key),
  FOREIGN KEY (organization_id, dataset_id, dataset_version_id, report_id, approval_event_id)
    REFERENCES public.quality_data_intelligence_reports
      (organization_id, dataset_id, dataset_version_id, report_id, approval_event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, dataset_id, dataset_version_id)
    REFERENCES public.quality_data_dataset_versions
      (organization_id, dataset_id, dataset_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, dataset_id, dataset_version_id, approval_event_id)
    REFERENCES public.quality_data_dataset_version_approval_events
      (organization_id, dataset_id, dataset_version_id, approval_event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reviewer_user_id, reviewer_membership_id)
    REFERENCES public.capa_organization_memberships
      (organization_id, user_id, membership_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, capa_case_id)
    REFERENCES public.capa_cases (organization_id, capa_case_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, capa_case_id, capa_case_version_id)
    REFERENCES public.capa_case_versions (organization_id, capa_case_id, case_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, capa_case_id, capa_section_version_id)
    REFERENCES public.capa_section_versions (organization_id, capa_case_id, section_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (capa_creation_audit_event_id)
    REFERENCES public.capa_audit_events (event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (handoff_audit_event_id)
    REFERENCES public.capa_audit_events (event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT quality_data_capa_handoff_finding
    CHECK (finding_key ~ '^(signal:S[1-9][0-9]*|metric:M[1-9][0-9]*|possible_cause:[0-7]|uncertainty:[0-7]|investigation_step:[0-7])$'),
  CONSTRAINT quality_data_capa_handoff_classification
    CHECK (
      (finding_key ~ '^signal:S[1-9][0-9]*$' AND finding_classification = 'deterministic_signal')
      OR (finding_key ~ '^metric:M[1-9][0-9]*$' AND finding_classification = 'deterministic_calculation')
      OR (finding_key ~ '^possible_cause:[0-7]$' AND finding_classification = 'advisory_hypothesis')
      OR (finding_key ~ '^uncertainty:[0-7]$' AND finding_classification = 'advisory_uncertainty')
      OR (finding_key ~ '^investigation_step:[0-7]$' AND finding_classification = 'advisory_investigation_step')
    ),
  CONSTRAINT quality_data_capa_handoff_versions
    CHECK (intelligence_schema_version = 'quality-data-intelligence-report-1.0.0'
      AND analysis_request_schema_version = 'quality-data-ai-analysis-request-1.0.0'
      AND analysis_result_schema_version = 'quality-data-ai-analysis-result-1.0.0'
      AND evidence_packet_version = 'quality-evidence-packet-1.0.0'
      AND char_length(btrim(dataset_schema_version)) BETWEEN 1 AND 100),
  CONSTRAINT quality_data_capa_handoff_fingerprints
    CHECK (result_fingerprint ~ '^[0-9a-f]{64}$'
      AND finding_fingerprint ~ '^[0-9a-f]{64}$'
      AND request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quality_data_capa_handoff_snapshot
    CHECK (jsonb_typeof(finding_snapshot) = 'object' AND pg_catalog.pg_column_size(finding_snapshot) <= 32768),
  CONSTRAINT quality_data_capa_handoff_evidence
    CHECK (jsonb_typeof(evidence_references) = 'array'
      AND jsonb_array_length(evidence_references) BETWEEN 1 AND 128
      AND pg_catalog.pg_column_size(evidence_references) <= 65536),
  CONSTRAINT quality_data_capa_handoff_interpretation
    CHECK (interpretation_status = 'unverified_advisory_hypotheses'),
  CONSTRAINT quality_data_capa_handoff_source_verification
    CHECK (source_verification = 'not_asserted'),
  CONSTRAINT quality_data_capa_handoff_decision
    CHECK (decision = 'create_capa_draft'),
  CONSTRAINT quality_data_capa_handoff_rationale
    CHECK (char_length(btrim(decision_rationale)) BETWEEN 3 AND 1000),
  CONSTRAINT quality_data_capa_handoff_idempotency
    CHECK (idempotency_key ~ '^QIH1-[0-9a-f]{64}$'),
  CONSTRAINT quality_data_capa_handoff_state
    CHECK (
      (handoff_status = 'pending' AND capa_case_id IS NULL AND capa_case_status IS NULL
        AND capa_case_version_id IS NULL AND capa_section_version_id IS NULL
        AND capa_creation_audit_event_id IS NULL AND handoff_audit_event_id IS NULL)
      OR
      (handoff_status = 'linked' AND capa_case_id IS NOT NULL AND capa_case_status = 'S00'
        AND capa_case_version_id IS NOT NULL AND capa_section_version_id IS NOT NULL
        AND capa_creation_audit_event_id IS NOT NULL AND handoff_audit_event_id IS NOT NULL)
    )
);

CREATE INDEX quality_data_intelligence_capa_handoffs_report_idx
  ON public.quality_data_intelligence_capa_handoffs
    (organization_id, report_id, finding_key);
CREATE INDEX quality_data_intelligence_capa_handoffs_case_idx
  ON public.quality_data_intelligence_capa_handoffs
    (organization_id, capa_case_id) WHERE capa_case_id IS NOT NULL;

CREATE FUNCTION private.quality_data_guard_capa_handoff_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.handoff_status <> 'pending' THEN
      RAISE EXCEPTION 'QUALITY_DATA_CAPA_HANDOFF_DECISION_MUST_PRECEDE_DRAFT';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUALITY_DATA_CAPA_HANDOFF_IMMUTABLE';
  END IF;
  IF OLD.handoff_status <> 'pending' OR NEW.handoff_status <> 'linked'
    OR ROW(
      NEW.handoff_id, NEW.organization_id, NEW.report_id, NEW.dataset_id,
      NEW.dataset_version_id, NEW.approval_event_id, NEW.intelligence_schema_version,
      NEW.analysis_request_schema_version, NEW.analysis_result_schema_version,
      NEW.evidence_packet_version, NEW.dataset_schema_version,
      NEW.result_fingerprint, NEW.finding_key,
      NEW.finding_classification, NEW.finding_fingerprint, NEW.finding_snapshot,
      NEW.evidence_references, NEW.source_verification, NEW.interpretation_status,
      NEW.decision, NEW.decision_rationale, NEW.reviewer_user_id,
      NEW.reviewer_membership_id, NEW.decided_at, NEW.request_id, NEW.correlation_id,
      NEW.idempotency_key, NEW.request_fingerprint, NEW.created_at
    ) IS DISTINCT FROM ROW(
      OLD.handoff_id, OLD.organization_id, OLD.report_id, OLD.dataset_id,
      OLD.dataset_version_id, OLD.approval_event_id, OLD.intelligence_schema_version,
      OLD.analysis_request_schema_version, OLD.analysis_result_schema_version,
      OLD.evidence_packet_version, OLD.dataset_schema_version,
      OLD.result_fingerprint, OLD.finding_key,
      OLD.finding_classification, OLD.finding_fingerprint, OLD.finding_snapshot,
      OLD.evidence_references, OLD.source_verification, OLD.interpretation_status,
      OLD.decision, OLD.decision_rationale, OLD.reviewer_user_id,
      OLD.reviewer_membership_id, OLD.decided_at, OLD.request_id, OLD.correlation_id,
      OLD.idempotency_key, OLD.request_fingerprint, OLD.created_at
    ) THEN
    RAISE EXCEPTION 'QUALITY_DATA_CAPA_HANDOFF_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.quality_data_guard_capa_handoff_transition()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.quality_data_require_linked_capa_handoff()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  final_status text;
BEGIN
  SELECT handoff.handoff_status INTO final_status
  FROM public.quality_data_intelligence_capa_handoffs AS handoff
  WHERE handoff.handoff_id = NEW.handoff_id;
  IF final_status IS DISTINCT FROM 'linked' THEN
    RAISE EXCEPTION 'QUALITY_DATA_CAPA_HANDOFF_LINK_REQUIRED';
  END IF;
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION private.quality_data_require_linked_capa_handoff()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER quality_data_intelligence_capa_handoff_transition
  BEFORE INSERT OR UPDATE OR DELETE ON public.quality_data_intelligence_capa_handoffs
  FOR EACH ROW EXECUTE FUNCTION private.quality_data_guard_capa_handoff_transition();
CREATE CONSTRAINT TRIGGER quality_data_intelligence_capa_handoff_commit_guard
  AFTER INSERT OR UPDATE ON public.quality_data_intelligence_capa_handoffs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.quality_data_require_linked_capa_handoff();

ALTER TABLE public.quality_data_intelligence_capa_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_data_intelligence_capa_handoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_data_intelligence_capa_handoffs_service
  ON public.quality_data_intelligence_capa_handoffs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.quality_data_intelligence_capa_handoffs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.quality_data_intelligence_capa_handoffs TO service_role;

COMMENT ON TABLE public.quality_data_intelligence_capa_handoffs IS
  'Atomic, explicit human decision and provenance link from one version-bound quality intelligence finding to one S00 CAPA draft. This handoff does not assert source verification, CAPA approval, or workflow advancement.';

COMMIT;
