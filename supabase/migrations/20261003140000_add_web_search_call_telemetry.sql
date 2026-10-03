BEGIN;

ALTER TABLE public.ai_request_telemetry
  ADD COLUMN web_search_calls integer NOT NULL DEFAULT 0;

ALTER TABLE public.ai_request_telemetry
  ADD CONSTRAINT ai_request_telemetry_web_search_calls_check
  CHECK (web_search_calls >= 0);

COMMENT ON COLUMN public.ai_request_telemetry.web_search_calls IS
  'Count of chargeable Responses API web_search_call actions with action.type=search. Historical rows default to zero because their actual search action count was not recorded.';

COMMIT;
