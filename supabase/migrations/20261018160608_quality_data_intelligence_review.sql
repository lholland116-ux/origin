BEGIN;

-- Stage 3D grants one distinct, human-only review permission to the
-- organization administrator role. Review decisions are triage only and do
-- not verify evidence or perform CAPA transitions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.capa_roles
    WHERE role_id = 'CAPA_ORG_ADMIN' AND status = 'active' AND human_authority
  ) THEN
    RAISE EXCEPTION 'QUALITY_DATA_ADMIN_ROLE_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.capa_roles
    WHERE role_id <> 'CAPA_ORG_ADMIN'
      AND 'quality_data.intelligence.review' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'QUALITY_DATA_INTELLIGENCE_REVIEW_PERMISSION_ROLE_CONFLICT';
  END IF;
END
$$;

UPDATE public.capa_roles
SET permissions = CASE
      WHEN 'quality_data.intelligence.review' = ANY(permissions)
        THEN permissions
      ELSE array_append(permissions, 'quality_data.intelligence.review')
    END,
    role_version = '1.5.0'
WHERE role_id = 'CAPA_ORG_ADMIN';

CREATE TABLE public.quality_data_intelligence_reports (
  report_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  dataset_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  approval_event_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  request_payload jsonb NOT NULL,
  request_fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  result_payload jsonb,
  result_fingerprint text,
  failure_code text,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  finalized_at timestamptz,
  UNIQUE (organization_id, report_id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, dataset_id, dataset_version_id, report_id, approval_event_id),
  FOREIGN KEY (organization_id, dataset_id, dataset_version_id)
    REFERENCES public.quality_data_dataset_versions
      (organization_id, dataset_id, dataset_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, dataset_id, dataset_version_id, approval_event_id)
    REFERENCES public.quality_data_dataset_version_approval_events
      (organization_id, dataset_id, dataset_version_id, approval_event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, requested_by_user_id, requested_by_membership_id)
    REFERENCES public.capa_organization_memberships
      (organization_id, user_id, membership_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT quality_data_intelligence_report_status
    CHECK (status IN ('processing', 'complete', 'failed')),
  CONSTRAINT quality_data_intelligence_report_request_size
    CHECK (pg_catalog.pg_column_size(request_payload) <= 32768),
  CONSTRAINT quality_data_intelligence_report_result_size
    CHECK (result_payload IS NULL OR pg_catalog.pg_column_size(result_payload) <= 262144),
  CONSTRAINT quality_data_intelligence_report_fingerprint
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quality_data_intelligence_report_result_fingerprint
    CHECK (result_fingerprint IS NULL OR result_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quality_data_intelligence_report_failure_code
    CHECK (failure_code IS NULL OR failure_code IN ('DENIED', 'NOT_FOUND', 'NOT_APPROVED', 'INVALID_REQUEST', 'EVIDENCE_INVALID', 'PROVIDER_ERROR', 'INVALID_MODEL_OUTPUT', 'COST_UNAVAILABLE', 'RATE_LIMIT_REQUIRED', 'UNAVAILABLE')),
  CONSTRAINT quality_data_intelligence_report_idempotency
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT quality_data_intelligence_report_final_state
    CHECK (
      (status = 'processing' AND result_payload IS NULL AND result_fingerprint IS NULL AND failure_code IS NULL AND finalized_at IS NULL)
      OR (status = 'complete' AND result_payload IS NOT NULL AND result_fingerprint IS NOT NULL AND failure_code IS NULL AND finalized_at IS NOT NULL)
      OR (status = 'failed' AND result_payload IS NULL AND result_fingerprint IS NULL AND failure_code IS NOT NULL AND finalized_at IS NOT NULL)
    )
);

CREATE INDEX quality_data_intelligence_reports_version_idx
  ON public.quality_data_intelligence_reports
    (organization_id, dataset_version_id, created_at DESC);

CREATE FUNCTION private.quality_data_guard_intelligence_report_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QUALITY_DATA_INTELLIGENCE_REPORT_IMMUTABLE';
  END IF;
  IF OLD.status <> 'processing'
    OR NEW.status NOT IN ('complete', 'failed')
    OR NEW.report_id IS DISTINCT FROM OLD.report_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.dataset_id IS DISTINCT FROM OLD.dataset_id
    OR NEW.dataset_version_id IS DISTINCT FROM OLD.dataset_version_id
    OR NEW.approval_event_id IS DISTINCT FROM OLD.approval_event_id
    OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
    OR NEW.requested_by_membership_id IS DISTINCT FROM OLD.requested_by_membership_id
    OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'QUALITY_DATA_INTELLIGENCE_REPORT_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.quality_data_guard_intelligence_report_transition()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER quality_data_intelligence_report_transition
  BEFORE UPDATE OR DELETE ON public.quality_data_intelligence_reports
  FOR EACH ROW EXECUTE FUNCTION private.quality_data_guard_intelligence_report_transition();

CREATE TABLE public.quality_data_intelligence_review_events (
  event_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  report_id uuid NOT NULL,
  dataset_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  approval_event_id uuid NOT NULL,
  finding_key text NOT NULL,
  finding_fingerprint text NOT NULL,
  transition_number integer NOT NULL,
  decision text NOT NULL,
  reviewer_user_id uuid NOT NULL,
  reviewer_membership_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  rationale text NOT NULL,
  previous_event_id uuid,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  UNIQUE (organization_id, event_id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, report_id, finding_key, transition_number),
  UNIQUE (organization_id, report_id, finding_key, event_id),
  FOREIGN KEY (organization_id, dataset_id, dataset_version_id, report_id, approval_event_id)
    REFERENCES public.quality_data_intelligence_reports
      (organization_id, dataset_id, dataset_version_id, report_id, approval_event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reviewer_user_id, reviewer_membership_id)
    REFERENCES public.capa_organization_memberships
      (organization_id, user_id, membership_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, report_id, finding_key, previous_event_id)
    REFERENCES public.quality_data_intelligence_review_events
      (organization_id, report_id, finding_key, event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT quality_data_intelligence_review_transition
    CHECK (transition_number > 0),
  CONSTRAINT quality_data_intelligence_review_finding
    CHECK (finding_key ~ '^(signal:S[1-9][0-9]*|metric:M[1-9][0-9]*|possible_cause:[0-7]|uncertainty:[0-7]|investigation_step:[0-7])$'),
  CONSTRAINT quality_data_intelligence_review_finding_fingerprint
    CHECK (finding_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quality_data_intelligence_review_decision
    CHECK (decision IN ('acknowledged', 'follow_up_requested', 'deferred')),
  CONSTRAINT quality_data_intelligence_review_rationale
    CHECK (char_length(btrim(rationale)) BETWEEN 3 AND 1000),
  CONSTRAINT quality_data_intelligence_review_idempotency
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT quality_data_intelligence_review_request_fingerprint
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quality_data_intelligence_review_previous
    CHECK ((transition_number = 1 AND previous_event_id IS NULL)
      OR (transition_number > 1 AND previous_event_id IS NOT NULL))
);

CREATE INDEX quality_data_intelligence_review_latest_idx
  ON public.quality_data_intelligence_review_events
    (organization_id, report_id, finding_key, transition_number DESC);
CREATE TRIGGER quality_data_intelligence_review_immutable
  BEFORE UPDATE OR DELETE ON public.quality_data_intelligence_review_events
  FOR EACH ROW EXECUTE FUNCTION private.quality_data_reject_immutable_mutation();

-- Analytical reports and their review history are readable only while the
-- exact approval event bound to the report remains the current approved
-- decision. This prevents direct authenticated table reads from bypassing
-- the application's approval-revocation check.
CREATE FUNCTION private.quality_data_intelligence_can_read(
  p_organization_id uuid,
  p_dataset_id uuid,
  p_dataset_version_id uuid,
  p_approval_event_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.quality_data_can_read(p_organization_id)
    AND EXISTS (
      SELECT 1
      FROM public.quality_data_dataset_version_approval_events AS approval
      WHERE approval.organization_id = p_organization_id
        AND approval.dataset_id = p_dataset_id
        AND approval.dataset_version_id = p_dataset_version_id
        AND approval.approval_event_id = p_approval_event_id
        AND approval.decision = 'approved'
        AND NOT EXISTS (
          SELECT 1
          FROM public.quality_data_dataset_version_approval_events AS later
          WHERE later.organization_id = approval.organization_id
            AND later.dataset_id = approval.dataset_id
            AND later.dataset_version_id = approval.dataset_version_id
            AND later.transition_number > approval.transition_number
        )
    )
$function$;
REVOKE ALL ON FUNCTION private.quality_data_intelligence_can_read(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.quality_data_intelligence_can_read(uuid, uuid, uuid, uuid)
  TO authenticated;

ALTER TABLE public.quality_data_intelligence_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_data_intelligence_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.quality_data_intelligence_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_data_intelligence_review_events FORCE ROW LEVEL SECURITY;

CREATE POLICY quality_data_intelligence_reports_admin_read
  ON public.quality_data_intelligence_reports FOR SELECT TO authenticated
  USING (private.quality_data_intelligence_can_read(
    organization_id, dataset_id, dataset_version_id, approval_event_id
  ));
CREATE POLICY quality_data_intelligence_reviews_admin_read
  ON public.quality_data_intelligence_review_events FOR SELECT TO authenticated
  USING (private.quality_data_intelligence_can_read(
    organization_id, dataset_id, dataset_version_id, approval_event_id
  ));

REVOKE ALL ON public.quality_data_intelligence_reports
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.quality_data_intelligence_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.quality_data_intelligence_reports TO service_role;
REVOKE ALL ON public.quality_data_intelligence_review_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.quality_data_intelligence_review_events TO authenticated;
GRANT SELECT, INSERT ON public.quality_data_intelligence_review_events TO service_role;

COMMENT ON TABLE public.quality_data_intelligence_reports IS
  'Version-bound quality intelligence output. AI text is unverified advisory only; source verification and CAPA decisions are not asserted. Processing reports are never automatically retried.';
COMMENT ON TABLE public.quality_data_intelligence_review_events IS
  'Append-only, version-bound human triage decisions for intelligence findings. Decisions do not verify source evidence or create/change/approve/close CAPA cases.';

COMMIT;
