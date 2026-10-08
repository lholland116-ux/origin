-- ER-CS4B durable, owner-authorized controls for the dormant execution runtime.
-- Control state is intentionally separate from run/step execution lifecycle state.

ALTER TABLE public.execution_runs
  ADD COLUMN control_state text NOT NULL DEFAULT 'active'
    CHECK (control_state IN ('active', 'pause_requested', 'paused', 'stop_requested', 'stopped', 'returned')),
  ADD COLUMN control_revision bigint NOT NULL DEFAULT 0 CHECK (control_revision >= 0);

CREATE TABLE public.execution_human_approval_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_id text NOT NULL CHECK (length(step_id) BETWEEN 1 AND 128),
  plan_fingerprint text NOT NULL CHECK (plan_fingerprint ~ '^[0-9a-f]{64}$'),
  step_fingerprint text NOT NULL CHECK (step_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'returned')),
  source text NOT NULL CHECK (source IN ('runtime_policy', 'owner_request')),
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  rationale text,
  CONSTRAINT execution_human_approval_run_step_key UNIQUE (run_id, step_id),
  CONSTRAINT execution_human_approval_identity_key UNIQUE (id, run_id, user_id),
  CONSTRAINT execution_human_approval_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_human_approval_source_actor_check CHECK (
    (source = 'runtime_policy' AND requested_by IS NULL)
    OR (source = 'owner_request' AND requested_by IS NOT NULL AND requested_by = user_id)
  ),
  CONSTRAINT execution_human_approval_decision_check CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL AND rationale IS NULL)
    OR (status = 'approved' AND decided_by IS NOT NULL AND decided_by = user_id AND decided_at IS NOT NULL AND rationale IS NULL)
    OR (status = 'returned' AND decided_by IS NOT NULL AND decided_by = user_id AND decided_at IS NOT NULL
      AND rationale IS NOT NULL AND length(btrim(rationale)) BETWEEN 1 AND 1000)
  )
);

CREATE INDEX execution_human_approval_pending_idx
  ON public.execution_human_approval_checkpoints (run_id, status, step_id);

CREATE TABLE public.execution_control_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  checkpoint_id uuid,
  action text NOT NULL CHECK (action IN (
    'approval_required', 'approved', 'returned', 'pause_requested', 'paused',
    'resumed', 'stop_requested', 'stopped'
  )),
  actor_user_id uuid,
  prior_state text NOT NULL CHECK (prior_state IN ('active', 'pause_requested', 'paused', 'stop_requested', 'stopped', 'returned')),
  new_state text NOT NULL CHECK (new_state IN ('active', 'pause_requested', 'paused', 'stop_requested', 'stopped', 'returned')),
  prior_control_revision bigint NOT NULL CHECK (prior_control_revision >= 0),
  control_revision bigint NOT NULL CHECK (control_revision = prior_control_revision + 1),
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision >= 0),
  rationale text CHECK (rationale IS NULL OR length(rationale) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_control_event_run_user_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.execution_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_control_event_checkpoint_fkey
    FOREIGN KEY (checkpoint_id, run_id, user_id)
    REFERENCES public.execution_human_approval_checkpoints(id, run_id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_control_event_actor_check CHECK (actor_user_id IS NULL OR actor_user_id = user_id),
  CONSTRAINT execution_control_event_run_revision_key UNIQUE (run_id, control_revision)
);

CREATE INDEX execution_control_events_run_created_idx
  ON public.execution_control_events (run_id, created_at, id);

CREATE OR REPLACE FUNCTION public.guard_execution_human_approval_checkpoint_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.step_id IS DISTINCT FROM OLD.step_id
     OR NEW.plan_fingerprint IS DISTINCT FROM OLD.plan_fingerprint
     OR NEW.step_fingerprint IS DISTINCT FROM OLD.step_fingerprint
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Execution approval checkpoint identity is immutable';
  END IF;

  IF OLD.status <> 'pending' OR NEW.status NOT IN ('approved', 'returned') THEN
    RAISE EXCEPTION 'Execution approval checkpoint decision is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER execution_human_approval_checkpoint_update_guard
  BEFORE UPDATE ON public.execution_human_approval_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.guard_execution_human_approval_checkpoint_update();

CREATE OR REPLACE FUNCTION public.reject_execution_control_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Execution control events are append-only';
END;
$function$;

CREATE TRIGGER execution_control_events_immutable
  BEFORE UPDATE ON public.execution_control_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_execution_control_event_mutation();

ALTER TABLE public.execution_human_approval_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_human_approval_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE public.execution_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_control_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.execution_human_approval_checkpoints FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.execution_control_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.execution_human_approval_checkpoints, public.execution_control_events TO authenticated, service_role;
GRANT INSERT, UPDATE ON TABLE public.execution_human_approval_checkpoints TO service_role;
GRANT INSERT ON TABLE public.execution_control_events TO service_role;

CREATE POLICY execution_human_approval_select_own
  ON public.execution_human_approval_checkpoints FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY execution_control_event_select_own
  ON public.execution_control_events FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON FUNCTION public.guard_execution_human_approval_checkpoint_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_execution_control_event_mutation() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON COLUMN public.execution_runs.control_state IS
  'Independent human-control lifecycle; step execution snapshots remain unchanged by pause/resume decisions.';
COMMENT ON TABLE public.execution_human_approval_checkpoints IS
  'Owner-scoped, plan-and-step-bound execution approval decisions; one checkpoint per run step.';
COMMENT ON TABLE public.execution_control_events IS
  'Append-only provenance for execution human-control transitions.';
