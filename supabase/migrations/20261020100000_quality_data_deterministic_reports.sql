BEGIN;

-- Extend the already-qualified CS1 handoff record to bind deterministic-only
-- Stage 3D reports. Existing AI report rows remain valid and unchanged.
ALTER TABLE public.quality_data_intelligence_capa_handoffs
  DROP CONSTRAINT quality_data_capa_handoff_versions,
  ADD CONSTRAINT quality_data_capa_handoff_versions CHECK (
    intelligence_schema_version = 'quality-data-intelligence-report-1.0.0'
    AND evidence_packet_version = 'quality-evidence-packet-1.0.0'
    AND char_length(btrim(dataset_schema_version)) BETWEEN 1 AND 100
    AND (
      (analysis_request_schema_version = 'quality-data-ai-analysis-request-1.0.0'
        AND analysis_result_schema_version = 'quality-data-ai-analysis-result-1.0.0'
        AND interpretation_status = 'unverified_advisory_hypotheses')
      OR
      (analysis_request_schema_version = 'quality-data-deterministic-analysis-request-1.0.0'
        AND analysis_result_schema_version = 'quality-data-deterministic-analysis-result-1.0.0'
        AND interpretation_status = 'not_requested')
    )
  ),
  DROP CONSTRAINT quality_data_capa_handoff_interpretation,
  ADD CONSTRAINT quality_data_capa_handoff_interpretation
    CHECK (interpretation_status IN ('unverified_advisory_hypotheses', 'not_requested'));

COMMENT ON TABLE public.quality_data_intelligence_capa_handoffs IS
  'Atomic, explicit human decision and provenance link from a version-bound deterministic or advisory intelligence finding to one S00 CAPA draft. Source verification, CAPA approval, and workflow advancement are never asserted.';

COMMIT;
